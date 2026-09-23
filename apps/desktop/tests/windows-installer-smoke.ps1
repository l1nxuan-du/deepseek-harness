<# Native installation checks use a unique product identity and a private directory. #>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$ProductName,
    [Parameter(Mandatory)][string]$RegistryKey, [Parameter(Mandatory)][string]$Language,
    [Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
# The machine-wide installer and its shortcuts require an elevated account.
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Installer checks install for all users; run them from an elevated Windows account'
}
. (Join-Path $PSScriptRoot 'windows-installer-ui.ps1')
[InstallerCapture]::Initialize()
[InstallerCapture]::ProductName = $ProductName
$installPath = Join-Path $OutputDirectory 'Installed App'
$appPath = Join-Path $installPath ($ProductName + '.exe')
$uninstaller = Join-Path $installPath ('Uninstall ' + $ProductName + '.exe')
$installKey = 'HKLM:\SOFTWARE\' + $RegistryKey
$uninstallKey = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + $RegistryKey
# The machine-wide installation owns the shared desktop and Start menu entries.
$desktopLink = Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) ($ProductName + '.lnk')
$menuLink = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) ('deepseek-harness-l1nxuan-du\' + $ProductName + '.lnk')
$applicationText = 'Installer test application is running.'
$processes = [Collections.Generic.List[Diagnostics.Process]]::new()
$results = [Collections.Generic.List[string]]::new()
$localizedCopy = @{ ENGLISH = @{}; SIMPCHINESE = @{} }
Get-Content (Join-Path $PSScriptRoot '../installer/strings.nsh') -Encoding UTF8 | ForEach-Object {
    if ($_ -match '^LangString (INSTALLER_\w+) \$\{LANG_(ENGLISH|SIMPCHINESE)\} "(.*)"$') {
        $localizedCopy[$Matches[2]][$Matches[1]] = $Matches[3]
    }
}
$copy = $localizedCopy[$Language]
if ($null -eq $copy) { throw "Unknown installer language: $Language" }

function Wait-Window([Diagnostics.Process]$Process) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($Process.HasExited) { throw "Setup exited before its window appeared: $($Process.ExitCode)" }
        $window = [InstallerCapture]::Find($Process.Id)
        if ($window -ne [IntPtr]::Zero) { return $window }
        Start-Sleep -Milliseconds 25
    } while ($timer.Elapsed.TotalSeconds -lt 60)
    throw 'Installer window did not appear'
}

function Wait-Control([Diagnostics.Process]$Process, [string]$Text, [switch]$Dialog) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($Process.HasExited) { throw "Process exited before '$Text': $($Process.ExitCode)" }
        $control = if ($Dialog) { [InstallerCapture]::FindDialogText($Process.Id, $Text) } else { [InstallerCapture]::FindText($Process.Id, $Text) }
        if ($control -ne [IntPtr]::Zero) { return $control }
        Start-Sleep -Milliseconds 25
    } while ($timer.Elapsed.TotalSeconds -lt 120)
    throw "Missing '$Text': $([InstallerCapture]::VisibleText($Process.Id))"
}

function Wait-Gone([Diagnostics.Process]$Process, [string]$Text) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        if ($Process.HasExited) { throw "Process exited while '$Text' was still shown: $($Process.ExitCode)" }
        if ([InstallerCapture]::FindText($Process.Id, $Text) -eq [IntPtr]::Zero) { return }
        Start-Sleep -Milliseconds 50
    } while ($timer.Elapsed.TotalSeconds -lt 180)
    throw "'$Text' stayed on screen"
}

function Start-Setup([string]$Path) {
    $arguments = @()
    if ($Path) { $arguments = @('/D=' + $Path) }
    $process = Start-Process -FilePath $Installer -ArgumentList $arguments -PassThru -WindowStyle Normal
    $processes.Add($process)
    $window = Wait-Window $process
    [InstallerCapture]::Reveal($window)
    return $process
}

function Click-Button([Diagnostics.Process]$Process, [IntPtr]$Window, [int]$Id) {
    $button = [InstallerCapture]::GetDlgItem($Window, $Id)
    if ($button -eq [IntPtr]::Zero) { throw "Installer button $Id is missing" }
    [InstallerCapture]::Click($button)
}

# The dialog-plugin pages keep their own message loop, so they leave through the wizard's next-page
# message instead of a synthesized click on the stock buttons.
function Leave-Page([IntPtr]$Window) { [InstallerCapture]::Advance($Window) }

function Wait-ControlId([Diagnostics.Process]$Process, [IntPtr]$Window, [int]$Id) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $control = [InstallerCapture]::FindId($Window, $Id)
        if ($control -ne [IntPtr]::Zero) { return $control }
        if ($Process.HasExited) { throw "Installer exited before control $Id with code $($Process.ExitCode)" }
        Start-Sleep -Milliseconds 50
    } while ($timer.Elapsed.TotalSeconds -lt 60)
    throw "Installer control $Id did not appear"
}

# The welcome page precedes the shortcut page on every interactive installation.
function Enter-ShortcutPage([Diagnostics.Process]$Process, [IntPtr]$Window) {
    for ($attempt = 0; $attempt -lt 3; $attempt++) {
        Click-Button $Process $Window 1
        $timer = [Diagnostics.Stopwatch]::StartNew()
        do {
            $control = [InstallerCapture]::FindText($Process.Id, $copy.INSTALLER_DESKTOP_SHORTCUT)
            if ($control -ne [IntPtr]::Zero) { return $control }
            if ($Process.HasExited) { throw "Setup exited while opening the shortcut page: $($Process.ExitCode)" }
            Start-Sleep -Milliseconds 50
        } while ($timer.Elapsed.TotalSeconds -lt 10)
    }
    throw "The shortcut page did not appear: $([InstallerCapture]::VisibleText($Process.Id))"
}

function Set-Checkbox([IntPtr]$Control, [bool]$Checked) {
    $state = if ($Checked) { 1 } else { 0 }
    if ([InstallerCapture]::CheckState($Control) -ne $state) { [InstallerCapture]::SetCheck($Control, $state) }
}

# The stock installation page keeps its progress bar until the wizard leaves it, so a completed
# page is advanced explicitly and a self-advancing wizard is never clicked twice.
function Wait-FinishPage([Diagnostics.Process]$Process, [IntPtr]$Window) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $advanced = $false
    do {
        if ($Process.HasExited) { throw "Setup exited before the finish page: $($Process.ExitCode)" }
        $check = [InstallerCapture]::FindCheckbox($Window)
        if ($check -ne [IntPtr]::Zero) { return $check }
        $progress = [InstallerCapture]::FindClass($Window, 'msctls_progress32')
        $next = [InstallerCapture]::GetDlgItem($Window, 1)
        if ($progress -ne [IntPtr]::Zero) {
            $advanced = $false
        } elseif (-not $advanced -and $timer.Elapsed.TotalSeconds -gt 2) {
            [InstallerCapture]::Click($next)
            $advanced = $true
        }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 300)
    throw "Installer did not reach the finish page: $([InstallerCapture]::VisibleText($Process.Id))"
}

function Wait-Exit([Diagnostics.Process]$Process, [int]$Seconds, [string]$Description) {
    if (-not $Process.WaitForExit($Seconds * 1000)) { throw "$Description did not exit" }
    return $Process.ExitCode
}

function Run-Silent([string]$Arguments, [int]$Code) {
    $process = Start-Process -FilePath $Installer -ArgumentList $Arguments -PassThru -WindowStyle Hidden
    $processes.Add($process)
    $exit = Wait-Exit $process 120 'Silent setup'
    if ($exit -ne $Code) { throw "Silent setup returned $exit, expected $Code" }
}

function Dismiss([Diagnostics.Process]$Process, [string]$Text) {
    $control = Wait-Control $Process $Text -Dialog
    $dialog = [InstallerCapture]::TopLevel($control)
    [InstallerCapture]::Click([InstallerCapture]::GetDlgItem($dialog, 1))
    $timer = [Diagnostics.Stopwatch]::StartNew()
    while ([InstallerCapture]::IsWindow($dialog)) {
        if ($timer.Elapsed.TotalSeconds -gt 15) { throw 'Dialog did not close' }
        Start-Sleep -Milliseconds 25
    }
}

function Wait-Application() {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
        $app = Get-Process -Name $ProductName -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -eq $appPath } | Select-Object -First 1
        if ($app) { return $app }
        Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 30)
    throw 'The installed application did not start'
}

function Assert-Link([string]$Path, [string]$Target) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "Missing shortcut: $Path" }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($Path)
    if ($link.TargetPath -ne $Target) { throw "Shortcut $Path targets '$($link.TargetPath)', expected '$Target'" }
}

function Assert-Registered() {
    $entry = Get-ItemProperty -Path $installKey -ErrorAction SilentlyContinue
    if ($null -eq $entry) { throw 'The installation is not registered' }
    if ($entry.InstallLocation.TrimEnd('\') -ne $installPath) { throw "Registered directory is '$($entry.InstallLocation)'" }
    $display = Get-ItemProperty -Path $uninstallKey -ErrorAction SilentlyContinue
    if ($null -eq $display -or -not $display.DisplayVersion) { throw 'The Add or Remove Programs entry is missing' }
}

try {
    # A fresh interactive installation keeps both default shortcuts and clears the launch option.
    $process = Start-Setup $installPath
    $window = [InstallerCapture]::Find($process.Id)
    [void][InstallerCapture]::Save($window, (Join-Path $OutputDirectory 'welcome.png'))
    Click-Button $process $window 1
    $directory = Wait-ControlId $process $window 1019
    if (-not ([InstallerCapture]::GetText($directory)).Contains($installPath)) {
        throw "The directory page does not show the requested destination: '$([InstallerCapture]::GetText($directory))'"
    }
    [void][InstallerCapture]::Save($window, (Join-Path $OutputDirectory 'directory.png'))
    $results.Add('directory-page-shows-requested-destination')
    # A destination the installer does not own is refused when the shortcut page is left.
    [InstallerCapture]::SetText($directory, (Join-Path $env:WINDIR 'Harness Installer Test'))
    Click-Button $process $window 1
    $desktop = Wait-Control $process $copy.INSTALLER_DESKTOP_SHORTCUT
    Leave-Page $window
    Dismiss $process $copy.INSTALLER_PATH_INVALID
    if ([InstallerCapture]::FindText($process.Id, $copy.INSTALLER_DESKTOP_SHORTCUT) -eq [IntPtr]::Zero) {
        throw 'A rejected destination left the shortcut page'
    }
    $results.Add('directory-page-validates-destination')
    Click-Button $process $window 3
    $directory = Wait-ControlId $process $window 1019
    [InstallerCapture]::SetText($directory, $installPath)
    Click-Button $process $window 1
    $desktop = Wait-Control $process $copy.INSTALLER_DESKTOP_SHORTCUT
    $menu = Wait-Control $process $copy.INSTALLER_START_MENU_SHORTCUT
    if ([InstallerCapture]::CheckState($desktop) -ne 1 -or [InstallerCapture]::CheckState($menu) -ne 1) {
        throw 'The shortcut choices are not selected by default'
    }
    $results.Add('welcome-and-shortcut-pages-render')
    $results.Add('shortcut-choices-default-checked')
    [void][InstallerCapture]::Save($window, (Join-Path $OutputDirectory 'shortcuts.png'))
    Leave-Page $window
    Wait-Gone $process $copy.INSTALLER_DESKTOP_SHORTCUT
    $launch = Wait-FinishPage $process $window
    if ([InstallerCapture]::CheckState($launch) -ne 1) { throw 'The stock finish page does not select the launch option by default' }
    Set-Checkbox $launch $false
    [void][InstallerCapture]::Save($window, (Join-Path $OutputDirectory 'finish.png'))
    Click-Button $process $window 1
    if ((Wait-Exit $process 300 'Installation') -ne 0) { throw 'Installation did not succeed' }
    if (-not (Test-Path -LiteralPath $appPath)) { throw 'Installation did not create the application' }
    if (Test-Path -LiteralPath (Join-Path $installPath 'launched.txt')) { throw 'A cleared launch option started the application' }
    Assert-Link $desktopLink $appPath
    Assert-Link $menuLink $appPath
    Assert-Registered
    $results.Add('finish-page-launch-option-cleared-skips-launch')
    $results.Add('shortcuts-created-and-registered')

    # A running application preserves its own installation instead of being stopped.
    $marker = Join-Path $installPath 'test-marker.txt'
    Set-Content -LiteralPath $marker -Value 'preserved'
    $app = Start-Process -FilePath $appPath -PassThru
    $processes.Add($app)
    [void](Wait-Control $app $applicationText -Dialog)
    $process = Start-Setup ''
    $window = [InstallerCapture]::Find($process.Id)
    [void](Enter-ShortcutPage $process $window)
    Leave-Page $window
    Dismiss $process $copy.INSTALLER_RUNNING
    if ((Wait-Exit $process 120 'Blocked update') -ne 2) { throw 'A blocked update did not return exit code 2' }
    if ($app.HasExited) { throw 'A blocked update stopped the running application' }
    if ((Get-Content -LiteralPath $marker) -ne 'preserved') { throw 'A blocked update changed the installed directory' }
    Dismiss $app $applicationText
    if (-not $app.WaitForExit(30000)) { throw 'The test application did not exit' }
    $results.Add('running-application-blocks-replacement')

    # A silent update replaces the registered directory and keeps the default shortcuts.
    Set-Content -LiteralPath $marker -Value 'stale'
    Run-Silent '/S --updated' 0
    if (-not (Test-Path -LiteralPath $appPath)) { throw 'A silent update removed the application' }
    if (Test-Path -LiteralPath $marker) { throw 'A silent update did not replace the installed directory' }
    Assert-Link $desktopLink $appPath
    Assert-Registered
    $results.Add('silent-update-replaces-registered-directory')

    # A registered directory keeps working when it was stored with a trailing separator.
    Set-ItemProperty -Path $installKey -Name InstallLocation -Value ($installPath + '\')
    Run-Silent '/S' 0
    if (-not (Test-Path -LiteralPath $appPath)) { throw 'A registered directory with separators lost the application' }
    Assert-Registered
    $results.Add('registered-directory-with-trailing-separators')

    # A non-empty destination that this installation does not own is refused.
    $foreign = Join-Path $OutputDirectory 'Foreign App'
    New-Item -ItemType Directory -Path $foreign -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $foreign 'keep.txt') -Value 'preserved'
    Run-Silent ('/S /D=' + $foreign) 2
    if ((Get-Content -LiteralPath (Join-Path $foreign 'keep.txt')) -ne 'preserved') { throw 'A refused destination lost its contents' }
    if (@(Get-ChildItem -LiteralPath $foreign).Count -ne 1) { throw 'A refused destination gained files' }
    $results.Add('silent-foreign-directory-refused')

    # An update keeps the default launch option, which starts the installed application.
    $process = Start-Setup ''
    $window = [InstallerCapture]::Find($process.Id)
    [void](Enter-ShortcutPage $process $window)
    Leave-Page $window
    Wait-Gone $process $copy.INSTALLER_DESKTOP_SHORTCUT
    $launch = Wait-FinishPage $process $window
    if ([InstallerCapture]::CheckState($launch) -ne 1) { throw 'An update cleared the default launch option' }
    Click-Button $process $window 1
    if ((Wait-Exit $process 300 'Update') -ne 0) { throw 'Update did not succeed' }
    $app = Wait-Application
    $processes.Add($app)
    [void](Wait-Control $app $applicationText -Dialog)
    if (-not (Test-Path -LiteralPath (Join-Path $installPath 'launched.txt'))) { throw 'The launch option did not start the application' }
    Dismiss $app $applicationText
    if (-not $app.WaitForExit(30000)) { throw 'The launched application did not exit' }
    $results.Add('finish-page-launch-option-starts-application')
} catch {
    Write-Output "Installer check failed: $_"
    throw
} finally {
    foreach ($process in $processes) {
        if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
        $process.Dispose()
    }
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
        if (-not $uninstall.WaitForExit(120000)) { $uninstall.Kill(); $uninstall.WaitForExit(); throw 'Test uninstaller timed out' }
        if ($uninstall.ExitCode -ne 0) { throw "Test uninstaller returned $($uninstall.ExitCode)" }
        $uninstall.Dispose()
        $timer = [Diagnostics.Stopwatch]::StartNew()
        while ((Test-Path -LiteralPath $appPath) -or (Test-Path -LiteralPath $installKey) -or (Test-Path -LiteralPath $uninstallKey)) {
            if ($timer.Elapsed.TotalSeconds -gt 60) { throw 'Test installation was not removed' }
            Start-Sleep -Milliseconds 100
        }
        if (Test-Path -LiteralPath $desktopLink) { throw 'Test removal kept the desktop shortcut' }
        if (Test-Path -LiteralPath $menuLink) { throw 'Test removal kept the Start menu shortcut' }
        $results.Add('uninstall-removes-application-shortcuts-and-registration')
    }
    $results | ForEach-Object { Write-Output "installer case passed: $_" }
}
