#!/bin/bash
# Installs the user-side pieces: GNOME extension, connect script, user service.
# System-side pieces (bluetoothd configuration) are printed at the end, they
# need root and a bluetoothd restart, see README.

set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
UUID="hearing-aid-presets@gheop.github"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="$HOME/.config/systemd/user"
CONF_DIR="$HOME/.config/hearing-aids"

echo "Extension -> $EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r "$HERE/extension/." "$EXT_DIR/"
# Translations: compile every po/<lang>.po into the extension's locale tree.
if command -v msgfmt > /dev/null; then
    for po in "$HERE"/po/*.po; do
        [ -e "$po" ] || continue
        lang="$(basename "$po" .po)"
        mkdir -p "$EXT_DIR/locale/$lang/LC_MESSAGES"
        msgfmt -o "$EXT_DIR/locale/$lang/LC_MESSAGES/hearing-aid-presets.mo" "$po"
    done
fi

echo "Script -> $BIN_DIR/connect-hearing-aids"
mkdir -p "$BIN_DIR"
install -m 755 "$HERE/scripts/connect-hearing-aids" "$BIN_DIR/connect-hearing-aids"

echo "User service -> $UNIT_DIR/hearing-aids-connect.service"
mkdir -p "$UNIT_DIR"
cp "$HERE/systemd/user/hearing-aids-connect.service" "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable hearing-aids-connect.service

if [ ! -f "$CONF_DIR/devices.conf" ]; then
    mkdir -p "$CONF_DIR"
    cat > "$CONF_DIR/devices.conf" <<'EOF'
# MAC addresses of your hearing aids (bluetoothctl devices)
LEFT=AA:BB:CC:DD:EE:FF
RIGHT=AA:BB:CC:DD:EE:00
# Optional names shown in GNOME. The left aid carries the stereo sink, so a
# name without a side suffix reads better in the sound menu.
LEFT_ALIAS="Hearing aids"
RIGHT_ALIAS="Hearing aids R"
EOF
    echo "Created $CONF_DIR/devices.conf: edit it with your aids' MAC addresses."
fi

# Enable the extension for the next session (GNOME only loads new extensions
# at login).
current="$(gsettings get org.gnome.shell enabled-extensions)"
case "$current" in
    *"$UUID"*) ;;
    "@as []") gsettings set org.gnome.shell enabled-extensions "['$UUID']" ;;
    *) gsettings set org.gnome.shell enabled-extensions "${current%]}, '$UUID']" ;;
esac

cat <<EOF

Done. Remaining steps (root):
  1. Edit /etc/bluetooth/main.conf as in bluetooth/main.conf.snippet
  2. sudo mkdir -p /etc/systemd/system/bluetooth.service.d
     sudo cp $HERE/bluetooth/noplugin-vcp.conf /etc/systemd/system/bluetooth.service.d/
  3. sudo systemctl daemon-reload && sudo systemctl restart bluetooth
Then log out and back in: the extension loads at login and the service
connects the aids.
EOF
