<#
    .SYNOPSIS
        Scans the project for HTML pages and regenerates the PAGES array inside
        data/document.js, producing a tree navigation for the Axure player sitemap.

    .DESCRIPTION
        The Axure player index.html loads data/document.js, which feeds
        $axure.document.sitemap.rootNodes. The sitemap plugin reads rootNodes
        to render the left-hand tree nav.

        This script scans two locations:
          1. html/        - flat .html files grouped under a "Website" folder
          2. files/<dir>/ - each subdirectory is a group; page.html and other
                            .html files become leaf nodes; nested subdirectories
                            become child folders (tree hierarchy). Subdirs with
                            only a single page.html are flattened to a leaf node.

        Page names are extracted from <title> tags, with common brand prefixes/
        suffixes detected and stripped automatically.
#>
param(
    [string]$DocumentJs = "",
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Root) { $Root = $ScriptDir }
if (-not $DocumentJs) { $DocumentJs = Join-Path $Root "data\document.js" }

# --- Title helpers -----------------------------------------------------------

function Get-RawTitle {
    param([string]$FilePath)
    if (Test-Path $FilePath) {
        $content = Get-Content $FilePath -Raw -ErrorAction SilentlyContinue
        if ($content -match '(?s)<title[^>]*>(.*?)</title>') {
            return $matches[1].Trim()
        }
    }
    return ""
}

function DetectBrand {
    param([array]$Titles)
    # Brand = a title segment that appears in at least half of all titles
    if ($Titles.Count -lt 2) { return "" }

    $partFreq = @{}
    foreach ($t in $Titles) {
        $parts = [regex]::Split($t, '\s*[-\u2013\u2014\u2015|:_]\s*') |
            Where-Object { $_.Trim() -ne "" } |
            ForEach-Object { $_.Trim() }
        $seen = @{}
        foreach ($p in $parts) {
            if (-not $seen.ContainsKey($p.ToLower())) {
                $seen[$p.ToLower()] = $true
                if ($partFreq.ContainsKey($p)) { $partFreq[$p]++ } else { $partFreq[$p] = 1 }
            }
        }
    }

    $threshold = [math]::Ceiling($Titles.Count / 2)
    $bestBrand = ""
    $bestCount = 0
    foreach ($kv in $partFreq.GetEnumerator()) {
        if ($kv.Value -ge $threshold -and $kv.Value -gt $bestCount) {
            $bestBrand = $kv.Key
            $bestCount = $kv.Value
        }
    }
    return $bestBrand
}

function StripBrand {
    param([string]$Title, [string]$Brand)
    if (-not $Title) { return $Title }
    if ($Brand -and $Brand.Length -gt 0) {
        $escaped = [regex]::Escape($Brand)
        $Title = [regex]::Replace($Title, "^$escaped\s*[-\u2013\u2014\u2015|:_]\s*", "")
        $Title = [regex]::Replace($Title, "\s*[-\u2013\u2014\u2015|:_]\s*$escaped$", "")
        $Title = $Title.Trim()
    }
    return $Title
}

function Resolve-PageName {
    param([string]$Title, [string]$Brand, [string]$Fallback)
    $name = StripBrand $Title $Brand
    if (-not $name) { return $Fallback }
    return $name
}

function Get-PageId {
    param([string]$RelPath)
    $parts = $RelPath -replace '\\','/' -split '/'
    if ($parts[-1] -eq 'page.html' -and $parts.Length -ge 2) { return $parts[-2] }
    return [IO.Path]::GetFileNameWithoutExtension($parts[-1])
}

function Escape-JsString {
    param([string]$s)
    return ($s -replace '\\','\\' -replace '"','\"')
}

# --- Collect pages: html/ group ----------------------------------------------

$nodes = @()

$htmlDir = Join-Path $Root "html"
if (Test-Path $htmlDir) {
    $htmlFiles = Get-ChildItem -Path $htmlDir -Filter "*.html" -File | Sort-Object Name
    $titles = @()
    foreach ($f in $htmlFiles) { $titles += (Get-RawTitle $f.FullName) }
    $brand = DetectBrand $titles

    $htmlChildren = @()
    foreach ($f in $htmlFiles) {
        $relPath  = "html/$($f.Name)"
        $rawTitle = Get-RawTitle $f.FullName
        $pageName = Resolve-PageName $rawTitle $brand ([IO.Path]::GetFileNameWithoutExtension($f.Name))
        $htmlChildren += @{
            id       = Get-PageId $relPath
            pageName = $pageName
            type     = "Wireframe"
            url      = $relPath
        }
    }
    if ($htmlChildren.Count -gt 0) {
        $nodes += @{ pageName = "Website"; type = "Folder"; url = ""; children = $htmlChildren }
    }
}

# --- Collect pages: files/ group --------------------------------------------

$filesDir = Join-Path $Root "files"
if (Test-Path $filesDir) {
    $subdirs = Get-ChildItem -Path $filesDir -Directory | Sort-Object Name

    # Brand detection across all files/ titles
    $allTitles = @()
    foreach ($dir in $subdirs) {
        $directPage = Join-Path $dir.FullName "page.html"
        if (Test-Path $directPage) { $allTitles += (Get-RawTitle $directPage) }
        $other = Get-ChildItem -Path $dir.FullName -Filter "*.html" -File |
            Where-Object { $_.Name -ne "page.html" }
        foreach ($f in $other) { $allTitles += (Get-RawTitle $f.FullName) }
    }
    $filesBrand = DetectBrand $allTitles

    $filesChildren = @()
    foreach ($dir in $subdirs) {
        $dirChildren = @()

        $directPage = Join-Path $dir.FullName "page.html"
        if (Test-Path $directPage) {
            $relPath  = "files/$($dir.Name)/page.html"
            $rawTitle = Get-RawTitle $directPage
            $pageName = Resolve-PageName $rawTitle $filesBrand $dir.Name
            $dirChildren += @{
                id       = $dir.Name
                pageName = $pageName
                type     = "Wireframe"
                url      = $relPath
            }
        }

        $otherHtml = Get-ChildItem -Path $dir.FullName -Filter "*.html" -File |
            Where-Object { $_.Name -ne "page.html" } | Sort-Object Name
        foreach ($f in $otherHtml) {
            $relPath  = "files/$($dir.Name)/$($f.Name)"
            $rawTitle = Get-RawTitle $f.FullName
            $pageName = Resolve-PageName $rawTitle $filesBrand ([IO.Path]::GetFileNameWithoutExtension($f.Name))
            $dirChildren += @{
                id       = "$($dir.Name)_$([IO.Path]::GetFileNameWithoutExtension($f.Name))"
                pageName = $pageName
                type     = "Wireframe"
                url      = $relPath
            }
        }

        # Nested subdirectories -> child folders (tree hierarchy)
        $nestedDirs = Get-ChildItem -Path $dir.FullName -Directory | Sort-Object Name
        $nestedChildren = @()
        foreach ($nd in $nestedDirs) {
            $ndChildren = @()
            $nestedHtml = Get-ChildItem -Path $nd.FullName -Filter "*.html" -File -Recurse |
                Sort-Object FullName
            $nestedTitles = @()
            foreach ($nf in $nestedHtml) { $nestedTitles += (Get-RawTitle $nf.FullName) }
            $nestedBrand = DetectBrand $nestedTitles

            foreach ($nf in $nestedHtml) {
                $rel      = $nf.FullName.Substring($Root.Length).TrimStart('\','/') -replace '\\','/'
                $rawTitle = Get-RawTitle $nf.FullName
                $pageName = Resolve-PageName $rawTitle $nestedBrand ([IO.Path]::GetFileNameWithoutExtension($nf.Name))
                $ndChildren += @{
                    id       = "$($dir.Name)_$($nd.Name)_$([IO.Path]::GetFileNameWithoutExtension($nf.Name))"
                    pageName = $pageName
                    type     = "Wireframe"
                    url      = $rel
                }
            }
            if ($ndChildren.Count -gt 0) {
                $nestedChildren += @{
                    pageName = $nd.Name
                    type     = "Folder"
                    url      = ""
                    children = $ndChildren
                }
            }
        }

        # Flatten: if only one page and no nested dirs, render as a leaf node
        if ($dirChildren.Count -eq 1 -and $nestedChildren.Count -eq 0) {
            $filesChildren += $dirChildren[0]
        } else {
            # Combine direct pages + nested folders under this dir's folder
            $allDirChildren = @()
            $allDirChildren += $dirChildren
            $allDirChildren += $nestedChildren
            $filesChildren += @{
                pageName = $dir.Name
                type     = "Folder"
                url      = ""
                children = $allDirChildren
            }
        }
    }

    if ($filesChildren.Count -gt 0) {
        $nodes += @{ pageName = "Prototype"; type = "Folder"; url = ""; children = $filesChildren }
    }
}

# --- Emit JavaScript array source --------------------------------------------

function NodesToJs {
    param([array]$items, [int]$indent = 2)
    $pad = ' ' * $indent
    $lines = @()
    for ($i = 0; $i -lt $items.Count; $i++) {
        $item = $items[$i]
        $id   = Escape-JsString $item.id
        $name = Escape-JsString $item.pageName
        $type = Escape-JsString $item.type
        $url  = Escape-JsString $item.url
        $comma = if ($i -lt $items.Count - 1) { "," } else { "" }
        if ($item.children -and $item.children.Count -gt 0) {
            $childJs = NodesToJs $item.children ($indent + 8)
            $lines += "$pad{ id: `"$id`", pageName: `"$name`", type: `"$type`", url: `"$url`", children: ["
            $lines += $childJs
            $lines += "$pad] }$comma"
        } else {
            $lines += "$pad{ id: `"$id`", pageName: `"$name`", type: `"$type`", url: `"$url`" }$comma"
        }
    }
    return $lines
}

$jsLines = NodesToJs $nodes
$pagesBlock = ($jsLines | ForEach-Object { $_ }) -join "`n"

# --- Patch document.js -------------------------------------------------------

$markerStart = "// ===== PAGES START (auto-generated by generate-sitemap.ps1) ====="
$markerEnd   = "// ===== PAGES END ====="

if (-not (Test-Path $DocumentJs)) {
    Write-Error "document.js not found at: $DocumentJs"
    exit 1
}

$src = [IO.File]::ReadAllText($DocumentJs)
$startIdx = $src.IndexOf($markerStart)
$endIdx   = $src.IndexOf($markerEnd)

if ($startIdx -lt 0 -or $endIdx -lt 0 -or $endIdx -lt $startIdx) {
    Write-Error "Could not find PAGES markers in document.js."
    exit 1
}

$arrayEnd = $src.IndexOf("`n", $endIdx)
if ($arrayEnd -lt 0) { $arrayEnd = $src.Length }

$newBlock = $markerStart + "`n" +
    "    var PAGES = [`n" +
    $pagesBlock + "`n" +
    "    ];`n" +
    "    " + $markerEnd

$newSrc = $src.Substring(0, $startIdx) + $newBlock + $src.Substring($arrayEnd)
[IO.File]::WriteAllText($DocumentJs, $newSrc)

Write-Host "Sitemap regenerated: $($nodes.Count) top-level group(s)"
$nodes | ForEach-Object {
    $count = if ($_.children) { $_.children.Count } else { 0 }
    Write-Host ("  - {0} ({1} pages)" -f $_.pageName, $count)
}