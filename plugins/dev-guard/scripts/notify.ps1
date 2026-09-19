# dev-guard の作業終了通知（Stop フックの最後に run_tests.js から別プロセスで起動される）。
# 音を鳴らし、「<プロジェクト名> の作業が終わりました」の小さな窓を、
# そのフックを動かしている Claude Code の窓（Cursor／ターミナル）の中央に出す。
# 窓はクリックで閉じる。放置なら5分で自動で閉じる。キー入力のフォーカスは奪わない。
# 位置の決め方はログ %LOCALAPPDATA%\dev-guard\notify.log に1行残す。
# 試験モード（-TestMode）: 音を鳴らさず、窓は3秒で自動で閉じる。手動確認用。
param(
  [string]$Project = "",
  [int]$ParentPid = 0,
  [int]$AutoCloseSeconds = 300,
  [string]$Chain = "",        # 呼び出し側が調べた親プロセスの系列（"pid1,pid2,..."。近い順）
  [switch]$TestMode
)
$ErrorActionPreference = "Continue"
if ($TestMode) { $AutoCloseSeconds = 3 }

# ---- ログ -------------------------------------------------------------
$logDir = Join-Path $env:LOCALAPPDATA "dev-guard"
$logPath = Join-Path $logDir "notify.log"
function Write-Log([string]$msg) {
  try {
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    if ((Test-Path $logPath) -and ((Get-Item $logPath).Length -gt 1MB)) { Remove-Item $logPath -Force }
    $line = "{0} [{1}] {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Project, $msg
    [System.IO.File]::AppendAllText($logPath, $line + [Environment]::NewLine, [System.Text.Encoding]::UTF8)
  } catch { }
}

# 途中で致命的な失敗（C# のコンパイル不可など）があっても、原因をログに残してから終わる
trap { Write-Log ("fatal: " + $_.Exception.Message); exit 1 }

# ---- Win32 と「フォーカスを奪わない窓」 ---------------------------------
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public static class DgWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  public class Win { public IntPtr Handle; public uint Pid; public string Title; public bool Iconic; }

  // 見えているトップレベル窓を、タイトル付きで列挙する
  public static List<Win> ListWindows() {
    var list = new List<Win>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      int n = GetWindowTextLength(h);
      if (n == 0) return true;
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new Win { Handle = h, Pid = pid, Title = sb.ToString(), Iconic = IsIconic(h) });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}

// 表示してもアクティブにならない（キー入力のフォーカスを奪わない）フォーム
public class DgNoActivateForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      var cp = base.CreateParams;
      cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
      cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW（タスクバーに出さない）
      return cp;
    }
  }
}
"@

# ---- 音（settings.json にあった通知と同じ音。試験モードでは鳴らさない） ----
if (-not $TestMode) {
  try {
    (New-Object System.Media.SoundPlayer (Join-Path $env:WINDIR "Media\notify.wav")).PlaySync()
  } catch {
    Write-Log ("sound failed: " + $_.Exception.Message)
    try { [Console]::Beep(880, 300) } catch { }
  }
}

# ---- 親プロセスをたどって Claude Code の窓を探す --------------------------
function Get-AncestorPids([int]$startPid) {
  $chain = @()
  $seen = @{}
  $cur = $startPid
  for ($i = 0; $i -lt 20 -and $cur -gt 0 -and -not $seen.ContainsKey($cur); $i++) {
    $seen[$cur] = $true
    $chain += $cur
    try {
      $p = Get-CimInstance Win32_Process -Filter "ProcessId = $cur" -ErrorAction Stop
      if (-not $p) { break }
      $cur = [int]$p.ParentProcessId
    } catch { break }
  }
  return $chain
}

# 親プロセスの系列。呼び出し側から -Chain で渡されていればそれを使い（hook を動かしたシェルは
# すぐ終わるため、その時点の情報のほうが正しい）、無ければ -ParentPid からここでたどる。
function Get-Chain {
  $list = @()
  foreach ($s in ($Chain -split ",")) { if ($s -match '^\d+$') { $list += [int]$s } }
  if ($list.Count -gt 0) { return $list }
  if ($ParentPid -gt 0) { return Get-AncestorPids $ParentPid }
  return @()
}

function Find-TargetWindow {
  $wins = [DgWin32]::ListWindows() | Where-Object { -not $_.Iconic }
  $chain = Get-Chain
  # フォルダ名に [ ] * ? が入っていても -like の記号として解釈されないようにする
  $proj = ""
  if ($Project) { $proj = [System.Management.Automation.WildcardPattern]::Escape($Project) }

  # 1) 親プロセスの系列が持つ窓で、タイトルにプロジェクト名を含むもの（Cursor の窓が複数あるとき用）
  if ($proj) {
    foreach ($pid_ in $chain) {
      $w = $wins | Where-Object { $_.Pid -eq $pid_ -and $_.Title -like "*$proj*" } | Select-Object -First 1
      if ($w) { return @{ Win = $w; How = "parent-process+title (pid $pid_)" } }
    }
  }
  # 2) 親プロセスの系列が持つ窓（近い親から順）
  foreach ($pid_ in $chain) {
    $w = $wins | Where-Object { $_.Pid -eq $pid_ } | Select-Object -First 1
    if ($w) { return @{ Win = $w; How = "parent-process (pid $pid_)" } }
  }
  # 3) タイトルにプロジェクト名を含む窓
  if ($proj) {
    $w = $wins | Where-Object { $_.Title -like "*$proj*" } | Select-Object -First 1
    if ($w) { return @{ Win = $w; How = "title-match" } }
  }
  return $null
}

$target = $null
$chainText = ""
try {
  $chainText = (Get-Chain) -join ">"
  $target = Find-TargetWindow
} catch { Write-Log ("window search failed: " + $_.Exception.Message) }

# ---- 窓の組み立て ------------------------------------------------------
$form = New-Object DgNoActivateForm
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
$form.TopMost = $true
$form.ShowInTaskbar = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(90, 120, 200)   # 外枠の色
$form.Padding = New-Object System.Windows.Forms.Padding(2)
$form.Size = New-Object System.Drawing.Size(460, 170)
$form.Cursor = [System.Windows.Forms.Cursors]::Hand

$panel = New-Object System.Windows.Forms.Panel
$panel.Dock = [System.Windows.Forms.DockStyle]::Fill
$panel.BackColor = [System.Drawing.Color]::White
$panel.Cursor = [System.Windows.Forms.Cursors]::Hand
$form.Controls.Add($panel)

$msg = New-Object System.Windows.Forms.Label
$msg.Text = "$Project の作業が終わりました"
$msg.Font = New-Object System.Drawing.Font("Yu Gothic UI", 17, [System.Drawing.FontStyle]::Bold)
$msg.ForeColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
$msg.AutoSize = $false
$msg.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$msg.Dock = [System.Windows.Forms.DockStyle]::Fill
$msg.Cursor = [System.Windows.Forms.Cursors]::Hand
$panel.Controls.Add($msg)

$clock = New-Object System.Windows.Forms.Label
$clock.Text = "完了 " + (Get-Date -Format "HH:mm") + "　（クリックで閉じる）"
$clock.Font = New-Object System.Drawing.Font("Yu Gothic UI", 12)
$clock.ForeColor = [System.Drawing.Color]::FromArgb(90, 90, 90)
$clock.AutoSize = $false
$clock.Height = 40
$clock.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$clock.Dock = [System.Windows.Forms.DockStyle]::Bottom
$clock.Cursor = [System.Windows.Forms.Cursors]::Hand
$panel.Controls.Add($clock)

# ---- 位置決め ----------------------------------------------------------
$how = "screen-center"
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$cx = $area.Left + $area.Width / 2
$cy = $area.Top + $area.Height / 2
if ($target) {
  $rect = New-Object DgWin32+RECT
  if ([DgWin32]::GetWindowRect($target.Win.Handle, [ref]$rect) -and ($rect.Right - $rect.Left) -gt 100) {
    $cx = ($rect.Left + $rect.Right) / 2
    $cy = ($rect.Top + $rect.Bottom) / 2
    $how = $target.How + " title=`"" + $target.Win.Title + "`""
    $area = [System.Windows.Forms.Screen]::FromHandle($target.Win.Handle).WorkingArea
  }
}
$x = [int]($cx - $form.Width / 2)
$y = [int]($cy - $form.Height / 2)
# 画面からはみ出さないように収める
$x = [Math]::Max($area.Left, [Math]::Min($x, $area.Right - $form.Width))
$y = [Math]::Max($area.Top, [Math]::Min($y, $area.Bottom - $form.Height))
$form.Location = New-Object System.Drawing.Point($x, $y)
$mode = if ($TestMode) { "test" } else { "normal" }
Write-Log ("mode=" + $mode + " position=" + $how + " at (" + $x + "," + $y + ") parentPid=" + $ParentPid + " chain=" + $chainText)

# ---- 閉じ方: クリック、または一定時間で自動 ------------------------------
$close = { $form.Close() }
foreach ($c in @($form, $panel, $msg, $clock)) { $c.Add_Click($close) }
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(1000, $AutoCloseSeconds * 1000)
$timer.Add_Tick({ $timer.Stop(); $form.Close() })
$timer.Start()

[System.Windows.Forms.Application]::Run($form)
