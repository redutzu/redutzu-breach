fx_version 'cerulean'
game 'gta5'

lua54 'yes'

author 'Redutzu'
description 'Standalone CCTV network breach minigame with promise-based server export'
version '1.0.0'

ui_page 'nui/dist/index.html'

shared_script 'config.lua'

client_script 'client/main.lua'
server_script 'server/main.lua'

file 'nui/dist/**'