; Entrée « Convertir avec Alambic » du clic droit de l'Explorateur, pour les fichiers et les dossiers.
; Clés sous HKCU : pas besoin de droits administrateur, retirées à la désinstallation.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\Alambic" "" "Convertir avec Alambic"
  WriteRegStr HKCU "Software\Classes\*\shell\Alambic" "Icon" "$INSTDIR\Alambic.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\Alambic" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\Alambic\command" "" '"$INSTDIR\Alambic.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Alambic" "" "Convertir avec Alambic"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Alambic" "Icon" "$INSTDIR\Alambic.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Alambic\command" "" '"$INSTDIR\Alambic.exe" "%1"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\Alambic"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Alambic"
!macroend
