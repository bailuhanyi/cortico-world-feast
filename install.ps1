# install.ps1 —— 把「食时」装进 Coo（Windows）
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -CooRoot "E:\Coopanion"
#   预演：... -DryRun      （只打印会做什么，不写任何文件）
#
# 做的事：
#   1. 校验 CooRoot 是 Coo 目录
#   2. Coo 在运行就停下（运行中改 config.json 会被内存态回写覆盖）
#   3. 备份 data\extensions\package.json 与 companion\config.json
#   4. 复制到 data\extensions\vendor\cortico-world-feast，再建 node_modules 下的 junction
#   5. 在 data\extensions\package.json 登记 file: 依赖
#   6. 在 data\home\companion\config.json 里加 worlds.feast（只补缺键，不覆盖已有值）
#   7. 写回自检（无 BOM、可解析）
#
# 注意：本文件必须以「UTF-8 with BOM」保存，否则 Windows PowerShell 5.1 会按 GBK 解码中文。

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CooRoot,
  [Alias('DryRun')][switch]$WhatIf,
  [switch]$SkipRunningCheck
)

$ErrorActionPreference = 'Stop'
$SelfDir = $PSScriptRoot
$PluginDir = $SelfDir
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Say($msg) { Write-Host $msg }
function Die($msg) { Write-Host "❌ $msg" -ForegroundColor Red; exit 1 }
function WriteJsonNoBom($path, $text) { [System.IO.File]::WriteAllText($path, $text, $Utf8NoBom) }

$pkgName = 'cortico-world-feast'

# ---------- 0. 插件本体 ----------
$metaPath = Join-Path $PluginDir 'package.json'
if (-not (Test-Path $metaPath)) { Die "找不到 $metaPath" }
$meta = Get-Content $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($meta.name -ne $pkgName) { Die "插件包名不对：$($meta.name)" }

# ---------- 1. 校验 Coo ----------
if (-not (Test-Path $CooRoot)) { Die "CooRoot 不存在：$CooRoot" }
$hasApp = Test-Path (Join-Path $CooRoot 'resources\app')
$hasExe = Test-Path (Join-Path $CooRoot 'Coopanion.exe')
if (-not ($hasApp -or $hasExe)) { Die "$CooRoot 看起来不是 Coo 安装目录" }

$cooExtDir = Join-Path $CooRoot 'data\extensions'
$vendorDir = Join-Path $cooExtDir 'vendor'
$destDir = Join-Path $vendorDir $pkgName
$linkDir = Join-Path $cooExtDir "node_modules\$pkgName"
$extPkg = Join-Path $cooExtDir 'package.json'
$companionCfg = Join-Path $CooRoot 'data\home\companion\config.json'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

$pluginPath = (Resolve-Path $PluginDir).Path.TrimEnd('\')
$vendorPath = $destDir.TrimEnd('\')
if ($pluginPath -ieq $vendorPath) { Die "当前目录就是已安装的扩展本体，别对自己安装。" }

Say "插件版本     : v$($meta.version)"
Say "Coo 安装目录 : $CooRoot"
Say "扩展真身     : $destDir"
Say "node_modules : $linkDir（junction）"
Say "世界配置     : $companionCfg"

# ---------- 2. 运行中检查 ----------
if (-not $SkipRunningCheck) {
  $running = Get-Process -Name 'Coopanion' -ErrorAction SilentlyContinue
  if ($running) {
    Say ""
    Say "⚠️  Coo 正在运行（PID $($running.Id -join ',')）。"
    Say "    请先完全退出 Coo 再跑本脚本；确认已退出仍报，用 -SkipRunningCheck。"
    exit 2
  }
}

# ---------- 3. 备份 ----------
if ($WhatIf) {
  Say "[DryRun] 会备份 package.json / config.json（.bak-$stamp）"
} else {
  foreach ($f in @($extPkg, $companionCfg)) {
    if (Test-Path $f) {
      Copy-Item $f "$f.bak-$stamp" -Force
      Say "已备份 $f.bak-$stamp"
    }
  }
}

# ---------- 4. 复制到 vendor + junction ----------
$skipTop = @('node_modules', '.git', '.tmp', 'test', 'tools', 'backups', 'install.ps1')
if ($WhatIf) {
  Say "[DryRun] 会复制 $PluginDir → $destDir（排除 test/tools/node_modules/.git），再建 junction"
} else {
  New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
  if (Test-Path $destDir) {
    $bak = "$destDir.bak-$stamp"
    Say "已存在旧版本，先改名备份：$bak"
    Move-Item $destDir $bak
  }
  New-Item -ItemType Directory -Path $destDir -Force | Out-Null
  $items = Get-ChildItem -Path $PluginDir -Force | Where-Object { $_.Name -notin $skipTop -and $_.Name -notlike '*.bak*' }
  foreach ($it in $items) { Copy-Item -Path $it.FullName -Destination $destDir -Recurse -Force }
  Say "已复制到 $destDir（$(@($items).Count) 个顶层项）"

  if (Test-Path $linkDir) {
    $linkItem = Get-Item $linkDir -Force
    $isLink = ($linkItem.LinkType -ne $null) -and ($linkItem.LinkType -ne '')
    if ($isLink) {
      & cmd /c rmdir "$linkDir" 2>$null | Out-Null
      if ([System.IO.Directory]::Exists($linkDir)) { [System.IO.Directory]::Delete($linkDir, $false) }
    } else {
      Move-Item $linkDir "$linkDir.bak-$stamp" -Force
    }
  }
  New-Item -ItemType Junction -Path $linkDir -Target $destDir | Out-Null
  Say "已建立链接：$linkDir → $destDir"
}

# ---------- 5. 登记依赖 ----------
if (-not (Test-Path $extPkg)) {
  if (-not $WhatIf) { WriteJsonNoBom $extPkg '{"name":"cortico-extensions","private":true,"dependencies":{}}' }
}
if ($WhatIf) {
  Say "[DryRun] 会在 $extPkg 的 dependencies 里加 `"$pkgName`": `"file:$destDir`""
} else {
  $pkg = Get-Content $extPkg -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not (@($pkg.PSObject.Properties.Name) -contains 'dependencies')) {
    $pkg | Add-Member -MemberType NoteProperty -Name dependencies -Value ([pscustomobject]@{})
  }
  $depPath = 'file:' + ($destDir -replace '\\', '/')
  $pkg.dependencies | Add-Member -MemberType NoteProperty -Name $pkgName -Value $depPath -Force
  WriteJsonNoBom $extPkg ($pkg | ConvertTo-Json -Depth 30)
  Say "已在 $extPkg 登记依赖"
}

# ---------- 6. 加 worlds.feast ----------
# 只补缺键；enabled 恒设为 true。饭点提醒默认开着，可以在面板里一键关。
$defaults = [ordered]@{
  enabled        = $true
  mealReminder   = $true
  mealSlots         = '11:30,18:00'
  mealGraceMin      = 20
  mealRetryMin      = 40
  mealMaxRetries    = 1
  tickSec           = 30
  askReaction    = $true
  dislikeChance     = 0
  avoidRepeat    = $true
  ownerFeedTTL      = 30
  menuSize          = 5
  comboSize         = 4
  togetherInviteMin = 20
  togetherMaxInvites = 2
  togetherTTLMin    = 60
  lifeEnabled       = $true
  lifeGenerateAt    = '22:00'
  lifePrecision     = 'halfhour'
  lifeUpcoming      = 3
  lifeTomorrowAfter = '18:00'
  lifeMomentEvents  = $true
  lifeDayType       = ''
  lifeVoiceOn       = $true
  lifeMaxItems      = 24
  lifeAdjustPast    = $false
  lifeFreeEnabled   = $true
  lifeFreeSlots     = '10:00,14:00,21:00'
  lifeFreeGoal      = 3
  lifeFreeGraceMin  = 20
  lifeFreeRetryMin  = 40
  lifeFreeMaxRetries = 1
  lifeFreeMenu      = "- 出去转转，走一小段路，看看外面现在什么样`n- 找点想看的东西看一会儿（视频、番、随便什么都行）`n- 发一条自己的动态，写一两句今天的心情`n- 就在家待着，听点东西、发会儿呆"
  lifeFreeAskReport = $true
  lifeWardrobeOn    = $true
  lifeWardrobeDir   = ""
  lifeWardrobeAutoOutfit = $true
}
if (-not (Test-Path $companionCfg)) {
  Say "WARN 没找到 $companionCfg（Coo 还没初始化过？先启动一次 Coo 再装）"
} elseif ($WhatIf) {
  Say "[DryRun] 会在 $companionCfg 的 worlds.feast 里补缺失键并设 enabled=true（已有值保留）"
} else {
  $cfg = Get-Content $companionCfg -Raw -Encoding UTF8 | ConvertFrom-Json
  if (-not (@($cfg.PSObject.Properties.Name) -contains 'worlds')) {
    $cfg | Add-Member -MemberType NoteProperty -Name worlds -Value ([pscustomobject]@{})
  }
  if (@($cfg.worlds.PSObject.Properties.Name) -contains 'feast') {
    $sec = $cfg.worlds.feast
  } else {
    $sec = [pscustomobject]@{}
    $cfg.worlds | Add-Member -MemberType NoteProperty -Name feast -Value $sec
  }
  foreach ($k in $defaults.Keys) {
    $has = @($sec.PSObject.Properties.Name) -contains $k
    if (-not $has) { $sec | Add-Member -MemberType NoteProperty -Name $k -Value $defaults[$k] -Force }
  }
  $sec | Add-Member -MemberType NoteProperty -Name enabled -Value $true -Force
  WriteJsonNoBom $companionCfg ($cfg | ConvertTo-Json -Depth 60)
  Say "已写入 worlds.feast（缺失键已补，已有值保留）"
}

# ---------- 7. 写回自检 ----------
if (-not $WhatIf) {
  foreach ($f in @($extPkg, $companionCfg)) {
    if (-not (Test-Path $f)) { continue }
    $bytes = [System.IO.File]::ReadAllBytes($f)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $parseOk = $true
    try { Get-Content $f -Raw -Encoding UTF8 | ConvertFrom-Json | Out-Null } catch { $parseOk = $false }
    if ($hasBom -or -not $parseOk) { Say "FAIL $f（BOM=$hasBom，可解析=$parseOk）" } else { Say "OK   $f（无 BOM、可解析）" }
  }
}

Say ""
Say "下一步："
Say "  1) 重启 Coo（完全退出再打开）"
Say "  2) 面板 → 世界 →「食时」，确认状态 active；配置里能看到 36 项（分 5 张卡），第一项是「饭点提醒」开关"
Say "  3) 面板里四个页签：菜单点一道菜看味道档案、右边「端给她」就会端过去；套餐整桌端；吃过什么看口味画像；今天看她的一天"
Say "  4) 不想按点被叫：把「饭点提醒」关掉即可（面板上的菜和工具都还在）"
Say ""
Say "不想要了：删 $linkDir 和 $destDir，把 *.bak-$stamp 改名回去，并从 package.json / config.json 里删掉 feast。"
