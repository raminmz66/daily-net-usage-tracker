UUID    := daily-net-usage-tracker@raminmz66.github.io
DEST    := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SRC     := $(CURDIR)/extension
STATE   := $(HOME)/.local/share/daily-net-usage-tracker/usage.json

.PHONY: help test install dev-link uninstall enable disable status logs state pack clean

help:
	@echo 'make test       run the test suite under standalone gjs'
	@echo 'make install    copy the extension into ~/.local/share/gnome-shell/extensions'
	@echo 'make dev-link   symlink it there instead, so edits apply on the next shell restart'
	@echo 'make enable     enable the extension'
	@echo 'make disable    disable the extension'
	@echo 'make status     show the extension state GNOME reports'
	@echo 'make logs       follow this extension'"'"'s shell log lines'
	@echo 'make state      print the persisted daily totals'
	@echo 'make uninstall  disable and remove it (leaves usage data alone)'
	@echo 'make pack       build $(UUID).zip for manual install'

test:
	@gjs tests/run.js

install: test
	@rm -rf '$(DEST)'
	@mkdir -p '$(DEST)'
	@cp -r '$(SRC)'/. '$(DEST)'/
	@echo 'installed to $(DEST)'

dev-link: test
	@rm -rf '$(DEST)'
	@mkdir -p '$(dir $(DEST))'
	@ln -s '$(SRC)' '$(DEST)'
	@echo 'linked $(DEST) -> $(SRC)'

enable:
	@gnome-extensions enable '$(UUID)' && echo 'enabled'

disable:
	@gnome-extensions disable '$(UUID)' && echo 'disabled'

status:
	@gnome-extensions info '$(UUID)'

logs:
	@journalctl --user -f -o cat /usr/bin/gnome-shell | grep --line-buffered -i 'daily-net-usage'

state:
	@cat '$(STATE)' 2>/dev/null || echo 'no usage recorded yet'

uninstall:
	-@gnome-extensions disable '$(UUID)' 2>/dev/null
	@rm -rf '$(DEST)'
	@echo 'removed $(DEST) (usage data at $(STATE) kept)'

pack:
	@cd '$(SRC)' && zip -qr '$(CURDIR)/$(UUID).zip' . && echo 'built $(UUID).zip'

clean:
	@rm -f '$(CURDIR)/$(UUID).zip'
