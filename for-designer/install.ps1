# install.ps1 — Windows 安装逻辑（由 install.bat 调用）
# 录入姓名/小组,注册定时采集(每小时扫描 Claude Code + Codex 会话并上报)。
# 采集为定时脚本 collect_cowork.py。
# 幂等、不破坏已有配置。

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$machine = $env:COMPUTERNAME

# 检测是否在交互式环境运行（后台静默运行时 stdin 不是交互式）
$interactive = [Environment]::UserInteractive -and ![Environment]::GetCommandLineArgs().Contains("-NonInteractive")

# trap:任何未捕获异常都打印 + 暂停,绝不闪退(让用户能看到错误)
trap {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host "  安装出错,请把以下信息截图反馈:" -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host $_.Exception.Message
    Write-Host ""
    Write-Host $_.ScriptStackTrace
    Write-Host ""
    Write-Host "=================================================="
    Write-Host "  安装脚本已结束。窗口可关闭。"
    Write-Host "=================================================="
    if ($interactive) { try { Read-Host "按回车退出..." } catch {} }
    exit 1
}

# ---- 身份录入（仅交互式运行时执行）----
$idfile = Join-Path $root "config\identity.json"
if ($interactive) {
    $has = $false
    if (Test-Path $idfile) {
        try {
            $id = Get-Content $idfile -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($id.user -and $id.group) {
                $has = $true
                Write-Host "已登记身份：$($id.user) · $($id.group)"
                Write-Host "如需修改，删除 config\identity.json 后重新运行。"
            }
        } catch {}
    }
    if (-not $has) {
        $gf = Join-Path $root "config\groups.json"
        try { $groups = Get-Content $gf -Raw -Encoding UTF8 | ConvertFrom-Json }
        catch { $groups = @("EBG软件产品设计组","PBG软件产品设计组","云产品设计组","基础平台设计组","智能设计效能组") }
        Write-Host "首次使用，请登记身份："
       $name = ""
        while ([string]::IsNullOrWhiteSpace($name)) { $name = Read-Host "第一步：请输入oa账号名称（示例：张三5），输入完成后按回车继续" }
        Write-Host "第二步：请输入编号选择小组（示例：5），输入完成后按回车继续："
        for ($k = 0; $k -lt $groups.Count; $k++) { Write-Host "    $($k+1)) $($groups[$k])" }
        $grp = ""
        while ([string]::IsNullOrWhiteSpace($grp)) {
            $sel = Read-Host "  小组编号"
            if ($sel -match "^[0-9]+$" -and [int]$sel -ge 1 -and [int]$sel -le $groups.Count) {
                $grp = $groups[[int]$sel - 1]
            }
        }
        $obj = [pscustomobject]@{ user=$name; group=$grp; machine=$machine }
        # 无 BOM UTF-8 写入（PowerShell 5.x 的 Set-Content -Encoding UTF8 会带 BOM，
        # 导致 Python json.load 读取失败 → 身份丢失。故用 .NET API 强制无 BOM）
        [System.IO.File]::WriteAllText($idfile, ($obj | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "已登记：$name · $grp"
    }
} else {
    # 后台静默运行：identity.json 必须已存在
    if (-not (Test-Path $idfile)) {
        Write-Host "ERROR: 后台模式运行，但 config\identity.json 不存在。请先交互式运行一次完成身份登记。" -ForegroundColor Red
        exit 1
    }
    Write-Host "后台模式运行，已确认身份文件存在。"
}

# ---- 注册 Cowork 定时采集（每小时自动扫描 Claude Code + Codex 会话并上报）----
$ErrorActionPreference = "Continue"  # 定时任务注册失败不中断
$coworkScript = Join-Path $root "scripts\collect_cowork.py"
$taskName = "HikAIUsageCoworkCollect"
if (Test-Path $coworkScript) {
    $pyExe = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $pyExe) { $pyExe = (Get-Command python3 -ErrorAction SilentlyContinue).Source }
    if ($pyExe) {
        # Python 版本检查:采集脚本要求 3.7+(用了 sys.stdout.reconfigure / f-string)。
        # python --version 输出到 stderr(2>&1 合并),解析主.次版本号。
        # 提示用纯 ASCII,避免 PowerShell 5.x 在 GBK/cp1252 代码页下中文乱码。
        $pyOk = $false
        $verResolved = $false
        $verLine = ""
        try {
            $verLine = (& $pyExe --version 2>&1 | Select-Object -First 1)
            $m = [regex]::Match([string]$verLine, "Python\s+(\d+)\.(\d+)")
            if ($m.Success) {
                $verResolved = $true
                $major = [int]$m.Groups[1].Value
                $minor = [int]$m.Groups[2].Value
                $pyOk = ($major -gt 3) -or ($major -eq 3 -and $minor -ge 7)
            }
        } catch { $pyOk = $false }
        if ($verResolved -and -not $pyOk) {
            Write-Host "WARNING: Python >= 3.7 required for collect_cowork.py (found: $([string]$verLine)). Scheduled collection skipped. Please install Python 3.7+ and re-run install.bat."
        } elseif (-not $verResolved) {
            Write-Host "WARNING: Could not determine Python version (found: $([string]$verLine)). Scheduled collection skipped. Please ensure python is installed and runnable, then re-run install.bat."
        } else {
            # 先删旧任务（如果有）
            try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false 2>$null } catch {}
            $registered = $false
            # 方式1：Register-ScheduledTask（需要管理员权限）
            try {
                $action = New-ScheduledTaskAction -Execute $pyExe -Argument "`"$coworkScript`""
                # 每小时重复:从当前时刻起,每 1 小时重复,持续 10 年(约 3650 天)
                $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
                # 关键:显式关闭电池限制。笔记本默认 DisallowStartIfOnBatteries=True,
                # 会导致电池模式下任务永远不执行(采集静默失败)。
                $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
                $settings.DisallowStartIfOnBatteries = $false
                $settings.StopIfGoingOnBatteries = $false
                Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "AI 使用采集：每小时扫描 Claude Code + Codex 会话并上报" -Force 2>$null | Out-Null
                $registered = $true
                Write-Host "已注册 Cowork 定时采集（计划任务，每小时）"
            } catch {}
            # 方式2：降级到 schtasks（命令行，当前用户权限即可）
            if (-not $registered) {
                try {
                    schtasks /Delete /TN $taskName /F 2>$null | Out-Null
                    $result = schtasks /Create /TN $taskName /TR "`"$pyExe`" `"$coworkScript`"" /SC HOURLY /MO 1 /F 2>&1
                    if ($LASTEXITCODE -eq 0) {
                        $registered = $true
                        Write-Host "已注册 Cowork 定时采集（schtasks，每小时）"
                    }
                } catch {}
            }
            # 方式2(schtasks)创建的任务默认开启电池限制,笔记本电池模式下不执行。
            # 尝试关闭电池限制:先直接改(管理员),失败则提升权限静默修改。
            if ($registered) {
                try {
                    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
                    if ($task -and $task.Settings.DisallowStartIfOnBatteries) {
                        try {
                            $task.Settings.DisallowStartIfOnBatteries = $false
                            $task.Settings.StopIfGoingOnBatteries = $false
                            Set-ScheduledTask -InputObject $task -ErrorAction Stop
                            Write-Host "已关闭电池限制"
                        } catch {
                            $fixCmd = '$t = Get-ScheduledTask -TaskName ''' + $taskName + '''; $t.Settings.DisallowStartIfOnBatteries = $false; $t.Settings.StopIfGoingOnBatteries = $false; Set-ScheduledTask -InputObject $t | Out-Null'
                            $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($fixCmd))
                            $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-EncodedCommand", $encoded -Verb RunAs -Wait -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
                            if ($proc -and $proc.ExitCode -eq 0) {
                                Write-Host "已关闭电池限制（提升权限）"
                            } else {
                                Write-Host "提示:电池模式下采集可能不执行,建议接电源后重新运行 install.bat"
                            }
                        }
                    }
                } catch {}
            }
            if (-not $registered) {
                Write-Host "Cowork 定时任务注册失败，不影响其他功能。可手动运行：$coworkScript"
            }
        }
    } else {
        Write-Host "未找到 python，跳过 Cowork 定时采集注册。"
    }
}

# ---- 防闪退:脚本结束前暂停,让用户看到输出/错误(双击 bat 运行时尤其重要)----
Write-Host ""
Write-Host "=================================================="
Write-Host "  安装脚本已结束。窗口可关闭。"
Write-Host "=================================================="
