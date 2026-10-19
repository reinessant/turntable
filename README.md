# Turntable

**A tactile player for your own music.** Your albums sit in a crate, the record spins on a turntable, lyrics scroll in time with the song, and when you need it out of the way the whole thing folds into a pocket cassette recorder.

🇷🇺 [Русская версия ниже](#turntable-по-русски)

- **Crate & turntable** – flip through your albums, drop the needle, drag the tonearm to wind to any moment, hold the platter to scratch.
- **Synced lyrics** – found automatically on [LRCLIB](https://lrclib.net) and kept on your computer, so they work offline. Or drop an `.lrc` next to a track.
- **Plugin rack** – seven studio-style units between the record and the volume: two equalizers, a leveling amp, a valve clipper, a sampler crusher, a lowpass filter and a tape echo.
- **Mini player & tray** – `Ctrl+M` folds the app into an always-on-top cassette recorder. A tray menu and global keys keep it within reach with the window hidden.
- **Search** – `Ctrl+K` finds albums, artists and tracks, even with the wrong keyboard layout or a typo.
- **Make it yours** – turntable and record colours, the mini player's body, display and cassette, dust in the air, start with Windows.

<p align="center">
  <img src="docs/screenshots/crate.webp" alt="Crate" width="49%">
  <img src="docs/screenshots/turntable.webp" alt="Turntable with synced lyrics" width="49%">
  <img src="docs/screenshots/plugins.webp" alt="Plugin rack" width="49%">
  <img src="docs/screenshots/mini-player.png" alt="Mini player" height="300">
  <img src="docs/screenshots/tray.png" alt="Tray menu" height="300">
</p>

Windows 10/11, x64. Your files are copied into the app's own folder, so moving the originals later changes nothing.

## Download and install

1. Open the **[Releases](../../releases)** page of this repository and download **`Turntable-Setup-0.1.0.exe`** from *Assets*.
2. Run it. Windows may say *"Windows protected your PC"* because the installer is not code-signed yet: click **More info → Run anyway**.
3. Press **Install**. The setup finishes in a few seconds; keep *Open when done* ticked and Turntable starts by itself. The setup speaks English and Russian: the **RU / EN** switch is in its top-right corner (it starts in your system language).

Turntable installs for the current user (no admin rights) into `%LOCALAPPDATA%\Turntable`. Your library lives in `%APPDATA%\app.turntable.player`.

## Using it

**Add music.** In the crate press **Import** (or `Ctrl+I`), or drag a folder or files onto the crate window. `mp3`, `flac`, `m4a`, `wav`, `ogg` and `opus` work. Title, artist and cover are taken from the tags and from a `cover.jpg` / `folder.jpg` in the folder; fix anything by hand, drag the handle to reorder, click a title to rename, then **Save album**.

**Play.** Scroll or use `←` `→` to flip through the crate (a few seconds of a random track play as a preview), click the sleeve or press `Enter`, then click the record (or press `Enter`) to drop the needle.

| Key | What it does |
|---|---|
| `Space` | play / pause |
| `←` `→` | previous / next track (on the crate: flip albums) |
| `Esc` | back to the crate |
| `Ctrl+K` or `/` | search the library |
| `Ctrl+I` | import an album |
| `Ctrl+M` | mini player on / off |
| `F11` | full screen / window |

Global keys (work with the window hidden, rebindable in *Settings → Keys*): media keys, and `Right Alt` + arrows – `←` `→` change the track, `↑` `↓` change the volume.

The first launch shows a welcome screen and a quick guide; both can be opened again in *Settings → About*.

## Build from source

The source code is in [`source/`](source).

Requirements: Windows, [Node.js](https://nodejs.org) 20+, [pnpm](https://pnpm.io), [Rust](https://rustup.rs) (stable, MSVC toolchain) and the WebView2 runtime (already on Windows 11).

```powershell
cd source
pnpm install

pnpm dev                    # the UI alone in a browser at http://127.0.0.1:1420 (demo albums)
pnpm tauri dev              # the real app with hot reload
pnpm tauri build            # app + NSIS installer -> src-tauri/target/release/bundle/nsis
pwsh installer/build.ps1    # the branded setup -> release/Turntable-Setup-<version>.exe
```

SoundCloud import is off in the public build: it needs your own app keys. Copy `.env.example` to `.env.local`, fill in `VITE_SC_CLIENT_ID` / `VITE_SC_CLIENT_SECRET` and rebuild.

Stack: [Tauri 2](https://tauri.app) (Rust) · React 19 · TypeScript · Vite · zustand · GSAP · Web Audio · music-metadata.

```
source/
├─ src/               React app: screens, audio engine, plugin rack, mini player
├─ src-tauri/         Rust backend: library, tray, global keys, window, installer config
├─ installer/         the branded setup (its own small Tauri app + UI)
├─ design-reference/  tokens, fonts and the deck artwork the UI is built on
└─ public/            static assets served as-is
```

## License

[MIT](LICENSE) © 2026 reinessant. Fonts, libraries and other bundled parts keep their own licences: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Bugs and ideas

Turntable is young and made by one person. If something breaks, looks off, or you are missing a feature, write to me – every message gets read:

- Telegram: [@openwoundsdotcom](https://t.me/openwoundsdotcom)
- Discord: `reinessant`

---

# Turntable (по-русски)

**Тактильный плеер для вашей собственной музыки.** Альбомы лежат в крейте, пластинка крутится на проигрывателе, тексты песен идут синхронно со звуком, а когда нужно не мешать, всё складывается в карманный кассетник.

- **Крейт и проигрыватель** – листайте альбомы, опускайте иглу, перематывайте перетаскиванием тонарма, придерживайте пластинку и скретчите.
- **Синхронные тексты** – находятся сами на [LRCLIB](https://lrclib.net) и сохраняются на компьютере, поэтому работают и без интернета. Либо положите `.lrc` рядом с треком.
- **Рэк плагинов** – семь студийных приборов между пластинкой и громкостью: два эквалайзера, компрессор, ламповый клиппер, сэмплер-краш, фильтр и ленточное эхо.
- **Мини-плеер и трей** – `Ctrl+M` складывает приложение в кассетник поверх всех окон. Меню в трее и глобальные клавиши управляют музыкой, пока окно спрятано.
- **Поиск** – `Ctrl+K` ищет альбомы, исполнителей и треки, даже в неправильной раскладке и с опечатками.
- **Настройте под себя** – цвета проигрывателя и пластинки, корпус, дисплей и кассета мини-плеера, пыль в воздухе, запуск вместе с Windows.

Windows 10/11, x64. Файлы копируются в собственную папку приложения, так что оригиналы потом можно переносить.

## Скачать и установить

1. Откройте страницу **[Releases](../../releases)** этого репозитория и скачайте **`Turntable-Setup-0.1.0.exe`** из блока *Assets*.
2. Запустите его. Windows может написать *«Система Windows защитила ваш компьютер»* – установщик пока не подписан сертификатом: нажмите **Подробнее → Выполнить в любом случае** (*More info → Run anyway*).
3. Нажмите **Install** (**Установить**). Установка занимает несколько секунд; оставьте галочку «Запустить после установки» – Turntable запустится сам. Язык установщика переключается кнопками **RU / EN** в правом верхнем углу (по умолчанию – язык системы).

Ставится для текущего пользователя (права администратора не нужны) в `%LOCALAPPDATA%\Turntable`. Библиотека лежит в `%APPDATA%\app.turntable.player`.

## Как пользоваться

**Добавить музыку.** В крейте нажмите **Import** (или `Ctrl+I`) либо перетащите папку или файлы в окно крейта. Подходят `mp3`, `flac`, `m4a`, `wav`, `ogg` и `opus`. Название, исполнитель и обложка берутся из тегов и из `cover.jpg` / `folder.jpg` в папке; всё можно поправить руками, порядок меняется перетаскиванием, название трека правится кликом. Потом **Save album**.

**Играть.** Листайте колесом или `←` `→` (на фоне играет кусочек случайного трека), кликните по конверту или нажмите `Enter`, затем кликните по пластинке (или `Enter`), чтобы опустить иглу.

Клавиши – в таблице выше. Глобальные клавиши работают при спрятанном окне и перенастраиваются в *Settings → Keys*: медиа-клавиши и `Right Alt` + стрелки (`←` `→` – трек, `↑` `↓` – громкость).

При первом запуске показываются приветствие и мини-гайд; их можно открыть снова в *Settings → About*.

## Сборка из исходников

Исходный код лежит в папке [`source/`](source). Нужны: Windows, Node.js 20+, pnpm, Rust (stable, MSVC) и WebView2. Команды – в разделе *Build from source* выше. Импорт из SoundCloud в публичной сборке выключен: ему нужны ваши собственные ключи (`.env.example` → `.env.local`).

## Лицензия

[MIT](LICENSE) © 2026 reinessant. Шрифты, библиотеки и прочие вложенные части сохраняют свои лицензии: см. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Баги и идеи

Turntable ещё молодой, и делает его один человек. Если что-то ломается, выглядит криво или не хватает фичи – пишите сюда, читаю всё:

- Telegram: [@openwoundsdotcom](https://t.me/openwoundsdotcom)
- Discord: `reinessant`
