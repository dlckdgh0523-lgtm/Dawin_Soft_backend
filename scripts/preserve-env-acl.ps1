param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceFile = (Resolve-Path -LiteralPath $Source).Path
$destinationFile = (Resolve-Path -LiteralPath $Destination).Path
if ([IO.Path]::GetDirectoryName($sourceFile) -ne [IO.Path]::GetDirectoryName($destinationFile)) { throw 'Same private directory required' }
$originalAcl = Get-Acl -LiteralPath $sourceFile
Set-Acl -LiteralPath $destinationFile -AclObject $originalAcl
$copiedAcl = Get-Acl -LiteralPath $destinationFile
if ($originalAcl.Sddl -ne $copiedAcl.Sddl) { throw 'Private ACL preservation failed' }
