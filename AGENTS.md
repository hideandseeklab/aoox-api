# aoox-api

NestJS 11 backend for aoox (self-hosted PaaS).

## Struktur folder

- Semua module ada di `src/modules/<nama-module>/`.
- Controller, service, dan DTO yang termasuk dalam satu flow disimpan bersama di
  subdirektori di bawah module, dinamai sesuai flow-nya. Contoh:

  ```
  src/modules/project/
  ├── project.module.ts
  ├── create-project/
  │   ├── create-project.controller.ts
  │   ├── create-project.service.ts
  │   └── create-project.dto.ts
  └── list-projects/
      ├── list-projects.controller.ts
      ├── list-projects.service.ts
      └── list-projects.dto.ts
  ```

## Perintah

- `npm run start:dev` — dev server (watch)
- `npm run build` — build ke `dist/`
- `npm run lint` — eslint --fix
- `npm test` / `npm run test:e2e`

## Git

- Jangan commit atau push kecuali diperintahkan secara eksplisit oleh user.

## Database

- PostgreSQL 16 via `docker-compose.yml` (`npm run db:up` / `db:down`), database `aoox`.
- Konfigurasi dari `.env` (lihat `.env.example`), dimuat oleh `@nestjs/config`.
- ORM: TypeORM (`src/modules/database/`). `synchronize` selalu `false` — perubahan schema lewat migrasi:
  - `npm run migration:generate -- src/modules/database/migrations/<Nama>`
  - `npm run migration:run` / `npm run migration:revert`
- Entity ditulis sebagai `*.entity.ts` di dalam module masing-masing (`src/modules/<module>/`), otomatis dimuat (`autoLoadEntities`).

## Auth

- `src/modules/auth/` — JWT (Bearer) via `@nestjs/jwt` + `passport-jwt`. Flow: `sign-in/`.
  Artefak non-flow (`jwt.strategy.ts`, `jwt-auth.guard.ts`, `current-user.decorator.ts`) di root module.
- `src/modules/user/` — entity `User` (`users`), `UserService` untuk query lintas flow.
- Onboarding: `setup-status/` (`GET /auth/setup-status`) dan `setup/` (`POST /auth/setup`, hanya saat tabel `users` kosong, transaksi SERIALIZABLE) membuat owner pertama.
  `me/` (`GET /auth/me`) dipakai web untuk memverifikasi session **dan** membawa `version` (versi API yang sedang berjalan dari `package.json`, `me/app-version.ts`, dibaca sekali) untuk semua peran —
  sidebar web menampilkannya di bawah logo tanpa panggilan tambahan (layout dashboard sudah memanggil `/auth/me`); `GET /instance/update` tetap owner-only.
- `AdminBootstrapService` (user module): kalau `ADMIN_EMAIL`+`ADMIN_PASSWORD` di-set dan belum ada user, buat owner saat boot. Idempotent — tidak pernah menimpa user yang ada.
  Dev: `.env` berisi `admin@gmail.com` / `admin` untuk ini (tidak ada lagi migrasi seed).
- Hash password lewat `src/modules/user/password.util.ts` (bcryptjs).
- **`JwtStrategy.validate` membaca ulang user dari DB tiap request** (role & keberadaan): ganti peran/hapus user berlaku di request berikutnya, bukan saat token 7 hari
  kedaluwarsa. Tiket terminal 60 detik tetap membawa `role` dari payload.
- **Anggota & undangan**: `src/modules/invitation/` — entity `Invitation` (`invitations`: email, role, `token_hash` SHA-256 unik, `invited_by_id`, `expires_at` 7 hari, `accepted_at`).
  `create-invitation` (owner/admin; hanya owner boleh mengundang owner; mengganti undangan pending untuk email yang sama; token hanya dikembalikan sekali +
  `acceptUrl` = `${WEB_ORIGIN}/invite/<token>`), `list/revoke-invitation`, **publik** `GET /invitations/by-token/:token` (preview) dan `POST /invitations/accept`
  (throttle 10/menit; email+role dari undangan, form hanya nama+password; klaim `accepted_at` dalam transaksi → satu link satu akun; membalas `SignInResponseDto`).
  `src/modules/user/`: `list-users` (owner/admin), `update-user-role` & `delete-user` (owner saja; tidak boleh diri sendiri, `assertNotLastOwner`,
  `assertOwnsNoProjects` karena `projects.owner_id` cascade). Tidak ada kirim email — link disalin dari Settings. Keanggotaan per project: lihat bagian Project.
- **API token** (`src/modules/api-token/`, entity `ApiToken` di `api_tokens`: `token_hash` SHA-256 unik `select:false`, `prefix` 10 char untuk tampilan, `expires_at`, `last_used_at`,
  `read_only`, `project_ids` jsonb):
  token `aoox_` + 40 alfanumerik, plaintext hanya dikembalikan sekali oleh `POST /api-tokens`; bertindak sebagai user pemiliknya (role sama, dibaca dari DB tiap request).
  `JwtAuthGuard` sekarang menerima keduanya: bearer yang `looksLikeApiToken` → `ApiTokenService.resolve` (hash lookup, cek expiry, `lastUsedAt` ditulis maks 1×/menit) → `req.user`
  `{sub,email,role,tokenId}`; selain itu jatuh ke passport-jwt. Token salah/kedaluwarsa → 401. Modul `@Global()` karena guard di-instantiate di tiap module. Flow `create/list/delete-api-token`
  (`/api-tokens`, milik user sendiri). **Scope per token** (migrasi `ApiTokenScope`): `readOnly` → tiap request yang mengubah state ditolak 403 (memakai `isWriteRequest()` yang sama
  dengan viewer, jadi tiket websocket tetap boleh); `projectIds` → token hanya melihat project itu **dan** ditolak di semua route ber-`@Roles` (kelola registry, server, proxy, swarm,
  notifikasi, maintenance, audit log, anggota — pengaturan platform). Yang tetap terbuka untuk token ber-scope adalah route platform **tanpa** `@Roles`, semuanya GET baca
  (`list-registries`, `list-repositories`, `list-tags`, `self-hosted-status`, `proxy-status`, `list-destinations`) — memang untuk semua member; `POST /users/me/password`
  juga tanpa `@Roles` tapi sudah menolak aktor API token sendiri. Tiket terminal (`POST /terminal/tickets`) = tulis → token baca-saja 403 (diuji). Keduanya diputuskan **hanya di `JwtAuthGuard`**, yang menaruh `TokenScope` di request context (`setTokenScope`;
  sesi mendapat `FULL_SCOPE`, sehingga scope yang kosong hanya berarti "bukan request HTTP" = pekerjaan background, bukan salah kabel); `ProjectAccessService.roleFor`/
  `accessibleProjectIds` meng-**iris**-nya dengan akses user — scope tidak pernah memperluas, termasuk untuk owner/admin platform. `POST`/`DELETE /api-tokens` menolak aktor
  yang memakai API token (`user.tokenId` → 403) supaya token tidak bisa mencetak token tanpa batas; `projectIds` yang diminta divalidasi lewat `accessibleProjectIds` pembuatnya.
  Diuji E2E (token penuh/baca saja/ber-scope): deploy 202/403/409, log-ticket 201 untuk ketiganya, `GET /databases/:id` project lain 200/200/404, `/proxy` `/swarm` `/audit-logs` 403 untuk
  token ber-scope. Belum: scope per resource (mis. hanya deploy), token milik organisasi.
- **Audit log** (`src/modules/audit-log/`, `@Global()`; entity `AuditLog` di `audit_logs`: aktor snapshot `actor_id`/`actor_email`, `via` session|token|webhook|anonymous, `token_id`,
  `action` = template route (`POST /applications/:id/deploy`), `path`, `params`, `body` (di-redact: key mengandung password/secret/token/key/content/env → `[redacted]`, string dipotong 200,
  total ≤ 4 KB; `redact.ts` pure & di-unit-test), `status`, `ip`). Ditulis `AuditLogInterceptor` (`APP_INTERCEPTOR`) untuk semua request non-GET yang sampai handler, dengan status akhir
  (2xx atau kode HttpException); guard yang menolak (401/403) tidak tercatat. `POST /auth/sign-in` & `/2fa` dicatat sendiri oleh `SignInService` (sukses 200 / gagal 401, IP).
  Insert fire-and-forget (`save` — `insert` TypeORM menolak tipe jsonb). Retensi 90 hari (`@Cron` 03:17). `GET /audit-logs?limit&before&actorId&action` owner/admin (cursor `before`).
- **Password**: `POST /users/me/password` (`change-password/`, butuh password lama, hanya sesi — bukan API token) dan `POST /users/:id/password` (`set-user-password/`, owner untuk
  non-owner, reset tanpa email — disampaikan langsung). Min. 8 karakter (dev `admin`/`admin` hanya lewat bootstrap env).
- **2FA TOTP** (`src/modules/auth/two-factor/`): `totp.ts` = implementasi sendiri RFC 4226/6238 (SHA-1, 6 digit, 30 s, ±1 langkah, base32, `otpauth://`) dengan vektor uji RFC —
  **bukan otplib** (v13 bergantung `@scure/base` ESM-only yang memecahkan Jest, pola yang sama dengan Nest v12). `qrcode` (CJS) untuk data URL QR. Kolom user: `totp_secret_encrypted`
  (AES `ENCRYPTION_KEY`, `select:false`), `totp_enabled`, `totp_backup_hashes` (SHA-256 10 kode cadangan, dihapus saat dipakai). Flow `POST /auth/2fa/setup` (rahasia baru + QR, belum aktif),
  `/enable {code}` (mengembalikan kode cadangan sekali), `/disable {password}`; owner `POST /users/:id/2fa/disable` untuk non-owner yang terkunci. Semua hanya dari sesi password.
  Sign-in dua langkah: `POST /auth/sign-in` → `{requiresTwoFactor, challengeToken}` (JWT 5 menit `scope: '2fa'`) → `POST /auth/sign-in/2fa {challengeToken, code}` (TOTP atau kode cadangan).
  **`JwtStrategy.validate` menolak JWT ber-`scope`** (challenge, tiket terminal/logs) sebagai sesi — sebelumnya challenge token lolos sebagai Bearer penuh. API token melewati 2FA (rahasia terpisah).
- **Swagger/OpenAPI**: `@nestjs/swagger@11` (v12 ESM-only seperti paket Nest lain) di `main.ts` → `/docs` (UI) dan `/docs-json`; skema DTO/entity diambil **plugin CLI** `@nestjs/swagger`
  di `nest-cli.json` (`introspectComments`, suffix `.dto.ts` & `.entity.ts`) — tanpa `@ApiProperty` manual. Jest tidak memakai plugin (hanya `nest build`), jadi skema hanya lengkap di build.
  Dekorator `@ApiTags/@ApiBearerAuth/@ApiOperation` baru dipakai di api-token; endpoint lain tampil tanpa deskripsi.
- `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`) — semua body harus lewat DTO class-validator.
- Rate limit: `@nestjs/throttler` global (300/menit) via `APP_GUARD`; `sign-in` & `setup` 10/menit, `terminal/tickets` 20/menit (`@Throttle`).
- Versi paket Nest harus di jalur v11 (`@nestjs/jwt@11`, `@nestjs/config@4`, `@nestjs/passport@11`, `@nestjs/typeorm@11`, `@nestjs/websockets@11`) —
  rilis v12 ESM-only dan memecahkan Jest.

## Project

- `src/modules/project/` — entity `Project` (`projects`, FK `owner_id` → `users`, cascade delete) dan **`ProjectMember`** (`project_members`: `project_id`+`user_id` unik, cascade
  keduanya, `role` `admin|developer|viewer`). **Akses per project** lewat satu tempat, `ProjectAccessService` (di-export ProjectModule): owner/admin platform → semua project (sebagai admin);
  pembuat (`owner_id`) → project itu sebagai admin; selain itu hanya project dengan row `project_members`. Project yang tak boleh dilihat = **404** (bukan 403, id tidak bocor).
  `ProjectService.findOwnedOrFail` dan 6 `findOwnedOrFail` lain (application, compose, managed DB, database backup, volume backup, job — job lewat app/DB/compose pemiliknya)
  memanggil `access.assertAccess(ownerId, project)`; `list-projects` memakai `access.whereAccessible`, `project-summary` `accessibleProjectIds` (`$1::boolean OR p.id = ANY($2)`).
  Yang **sengaja** tidak lewat cek: gateway logs/terminal (tiketnya sudah lewat `findOwnedOrFail`), webhook (token = auth), semua pekerjaan background (scheduler/watcher/runner memakai repo
  langsung — jangan dialihkan ke cek ini, nanti berhenti terjadwal), resource platform (registry, server, proxy, notifikasi, swarm…) yang dijaga `RolesGuard`. Penolakan guard tidak masuk audit log
  (404 probing anggota tidak tercatat). Spec `project-access.service.spec.ts` memutar ke-7 helper: anggota lihat, orang luar 404 — gagal bila ada resource ke-8 yang lupa.
  Migrasi `ProjectMembers` **mem-backfill** setiap user `member` ke setiap project sebagai `developer` (upgrade tidak mengubah apa pun sampai admin mengeluarkan orang).
  **Level peran**: `admin` = kelola anggota + hapus project (`assertAdmin` → 403); `developer` = semua aksi lain; `viewer` = **baca saja** — ditegakkan terpusat di `assertAccess`
  lewat `src/modules/auth/request-context.ts`: middleware global menaruh `{method, path}` request di `AsyncLocalStorage` (`req.originalUrl`, karena `req.path` relatif terhadap mount point
  middleware), `isWriteRequest()` (pure, di-unit-test) menganggap GET/HEAD/OPTIONS dan POST `…/log-ticket` (tiket websocket = baca) sebagai baca, selain itu tulis → viewer 403.
  Pekerjaan background tidak punya store → tidak pernah dibatasi. Konsekuensi yang disengaja: `POST /databases/:id/query` ditolak untuk viewer meski hanya SELECT (endpoint-nya bisa menulis
  untuk owner/admin). `get-application`/`get-database` mengembalikan `projectRole` agar web bisa menyembunyikan aksi. Diuji: viewer GET app/db/log 200, log-ticket 201, deploy/patch/delete/backup/query 403,
  kelola anggota 403; developer boleh ubah project tapi anggota & hapus project 403. Flow anggota: `list-members` (`GET /projects/:id/members` → `{myRole, members[]}` termasuk anggota implisit), `add-member` (`POST`, by **email** akun yang sudah ada;
  owner/admin platform & pembuat ditolak 400 karena sudah implisit), `update-member` (`PATCH /:userId`), `remove-member`. Hapus user: row keanggotaan ikut cascade.
- `project-summary/` (`GET /projects/summary`, didaftarkan **sebelum** `get-project` agar tidak tertangkap `:id`): `{total, active, inactive}` — aktif = punya ≥1 application/
  managed database/compose app berstatus `running` (kolom status yang diamati aoox, satu query SQL dengan `count(*) FILTER`), tanpa panggilan Docker; difilter per akses.
- `list-projects/` membalas `ProjectListItemDto` = project + `instances[]` (`{kind: application|database|compose, id, name, status, engine, deploying}`; satu query
  `UNION ALL` atas tiga tabel dengan `project_id = ANY($1)`, raw SQL seperti summary karena ProjectModule tidak bisa meng-import module lain — mereka meng-import-nya)
  untuk kartu overview. **`deploying`**: badge "sedang deploy" tanpa panggilan Docker — application = `EXISTS` di `deployments` dengan status aktif
  (`queued`/`building`/`pushing`/`starting`, subquery per baris di dalam `UNION ALL` yang sama, masih satu round-trip); database = `status = 'creating'`;
  compose = `status = 'deploying'` (stack sudah punya status ini sendiri, disamakan bentuknya jadi satu boolean seragam lintas kind supaya web tidak perlu
  logika per-kind). Web: `project-card.tsx` menampilkan badge amber + `ProjectsAutoRefresh` (client component, `router.refresh()` tiap 4 detik) yang hanya
  aktif selama ada instance `deploying` di halaman `/projects`, berhenti sendiri begitu badge terakhir hilang.
- Flow: `create-project/`, `list-projects/`, `get-project/`, `update-project/`, `delete-project/` — semua `@UseGuards(JwtAuthGuard)`,
  owner diambil dari `@CurrentUser()`, tidak pernah dari body.
- Kolom waktu memakai `timestamptz` (migrasi `UseTimestamptz`); gunakan tipe yang sama untuk entity baru.

## Terminal (web shell)

- `src/modules/terminal/` — `terminal.gateway.ts`: Socket.IO gateway namespace `/terminal` (`@nestjs/websockets` +
  `@nestjs/platform-socket.io`, sesuai https://docs.nestjs.com/websockets/gateways), satu `TerminalSession` per socket. Flow `create-ticket/` (`POST /terminal/tickets`).
- Backend shell dipilih `terminal-backend.service.ts`: **`ssh.session.ts`** (library `ssh2`, ke host) bila `TERMINAL_SSH_HOST` di-set,
  kalau tidak **`local-pty.session.ts`** (`node-pty`: PowerShell di Windows / `$SHELL` di Unix). Di Docker selalu pakai SSH agar terminal masuk ke host, bukan container.
- `src/modules/ssh/` — primitif SSH bersama: `ssh.session.ts` (`SshSession.open(target, size)`, library `ssh2`) dan `ssh-key.service.ts` (**key platform** otomatis:
  ed25519 via `ssh2.utils.generateKeyPairSync`, disimpan di `TERMINAL_SSH_KEY_DIR`, default `./secrets` — di dist compose `/run/secrets/aoox`, bind mount rw, di-gitignore;
  helper `authorizeCommand`, `describeKeyError`, `isAuthFailure`). `SshModule` di-import terminal & server module.
- Kredensial SSH ke host (urutan prioritas): `TERMINAL_SSH_PRIVATE_KEY`/`_FILE` → `TERMINAL_SSH_PASSWORD` → key platform.
  API tidak bisa menulis `authorized_keys` host, jadi user menjalankan satu perintah sekali di host. Perintah + public key tampil di
  `GET /terminal/status` (`terminal-status/`, owner/admin) dan dikirim gateway sebagai event `error` saat SSH gagal auth (`isAuthFailure`);
  dir key tidak writable (uid 1000) → `SshKeyPermissionError` + petunjuk `chown`. Masalah kredensial tidak pernah menggagalkan boot — hanya muncul per koneksi/status.
- **`TERMINAL_SSH_USER` kosong → `root`** (`DEFAULT_TERMINAL_SSH_USER` di `terminal-backend.service.ts`): `install.sh`/`aoox install` menulis `TERMINAL_SSH_USER=root` hanya untuk
  instalasi BARU, sedangkan `aoox update`/"Terapkan update" hanya mengganti image dan tidak pernah menyentuh `.env.dist` — instalasi lama tidak punya barisnya, dan dulu terminal
  melempar `TERMINAL_SSH_USER is not set` walau `TERMINAL_SSH_HOST` terisi. Sekarang backend SSH-ke-host memakai `root` (default installer; install-nya sendiri butuh root).
  **Hanya** untuk backend env — server remote tetap memakai `Server.username`-nya sendiri. `GET /terminal/status` tidak lagi punya error itu dan membalas `username` efektif +
  `usernameSource: 'env' | 'default'` (null di mode lokal) supaya web membedakan "diset eksplisit" dari "default". Event Socket.IO `error` kini punya argumen kedua opsional
  `hint` (`'environment'` = gagal membuka shell host, `'servers'` = server remote; `undefined` untuk PTY lokal dan error tiket/origin) — dihitung `TerminalGateway.configHint()`
  dan dicermin di web (`terminal.protocol.ts`), dipakai `terminal-view.tsx` untuk menampilkan tautan ke Infrastruktur → Environment / Server remote (Environment hanya owner,
  jadi admin melihat nama halamannya, bukan tautan).
- **Server remote** (`src/modules/server/`, entity `Server` di `servers`: host/port/username, `private_key_encrypted` nullable `select:false` — null = pakai key platform):
  flow `create/list/delete-server`, `test-server` (buka+tutup shell; gagal auth → `authorizeCommand` bila memakai key platform), `platform-ssh-key/` (`GET /servers/ssh-key`).
  Semua `@Roles('owner','admin')`. `ServerService.resolve(id)` → `SshTarget` (+`usesPlatformKey`).
  Terminal ke server remote: klien kirim `serverId` di body `POST /terminal/tickets`; service memverifikasi server ada dan **mengikatnya ke payload tiket** —
  gateway hanya membaca `payload.serverId`, `handshake.auth.serverId` diabaikan. `TerminalBackendService.open(size, serverId?)`; `authHint(serverId?)` untuk pesan gagal auth.
- **Deploy ke server remote**: `Application.serverId` (FK `servers`, `ON DELETE RESTRICT` → hapus server yang masih punya app = 409). Transport = cara `docker -H ssh://`:
  `ssh-docker.agent.ts` (docker module) = `http.Agent` yang per request meng-`exec` **`docker system dial-stdio`** di server lewat satu sesi `ssh2` (lazy, reconnect) —
  hanya butuh docker CLI di server, bukan port forwarding (sshd yang di-hardening `AllowTcpForwarding no` tetap jalan; streamlocal forward gagal di sana). Channel ssh2 diberi
  no-op `setNoDelay/setKeepAlive/setTimeout/ref/unref` supaya diterima klien HTTP Node; **harus lewat Agent** — `createConnection` di opsi request dengan `agent:false` diabaikan Node
  (request nyasar ke localhost:80). `DockerEngineClient` menerima `{socketPath}` atau `{agent,label}`; `engine.target` untuk log.
  `DockerHandle` (docker.service.ts) = helper (`findContainerByName`, `ensureNetwork/Image`, `runOnce*`) di atas satu engine; `DockerService` = handle lokal.
  `RemoteDockerService.forServer(serverId|null)` (server module, cache satu sesi per server, `forget(id)`) dipakai runner, get/stop/start/delete, logs, logs gateway, metrics,
  dan builder nixpacks (`build(input, onLine, docker)`). Di server remote: build di daemon server, **tidak ada push** ke registry (registry lokal tidak terjangkau dari sana;
  imageRef `aoox/<project>/<app>:<tag>`, rollback memakai image yang masih ada di server), **tanpa label Traefik** (proxy hanya di host — pakai port host),
  metrik & notifikasi container-mati **ikut dipantau** (lihat "Pemantauan server remote" di bawah); disk-watcher, certificate-watcher, dan retensi disk tetap lokal. `test-server` juga mengecek Docker lewat tunnel (`dockerVersion`/`dockerError`).
- **Proxy per server**: `ProxyService` kini bekerja pada `DockerHandle` mana pun dengan `ProxySettings` eksplisit (`statusOn/provisionOn/removeOn`; `status/provision/remove` =
  handle lokal + `localSettings` dari env). `Server` punya `proxy_http_port`/`proxy_https_port`/`acme_email`/`acme_staging` (`proxySettingsOf(server)`); flow `server-proxy/`
  (`GET/POST/DELETE /servers/:id/proxy`, POST menyimpan setting lalu **mengganti** container proxy yang ada). Runner `replaceContainer` tidak lagi membuang domain untuk app remote:
  label Traefik dibuat dengan setting proxy server itu (`labelsFor(..., settings)`), jadi tab Domain & cek DNS berlaku di server remote. Nama container proxy sama (`aoox-proxy`)
  di tiap daemon — jangan mengarahkan "server" ke daemon yang sama dengan host (uji saya memakai container sshd+docker-cli dengan socket host: proxy host ikut terganti; diprovision ulang).
- **Backup volume di server remote**: `VolumeBackupService` memakai `remote.forServer(app.serverId)` untuk helper tar/restore/unduh/hapus; `BackupDestinationService.upload/download/remove`
  dan `BackupFilesService.localFiles/annotate/ensureLocal` menerima `DockerHandle` opsional (rclone & busybox berjalan di daemon app; volume `aoox_backups` ada per daemon).
  Gate `serverId` di service/scheduler/controller dihapus. Diuji lewat server simulasi SSH: proxy provision + domain routing, backup → restore → unduh.
- Event: klien → `input(string)`, `resize({cols,rows})`; server → `output`, `exit`, `error`. Definisi di `terminal.protocol.ts` (dicermin di web).
- Auth: browser tidak bisa kirim header Authorization di handshake, jadi klien menukar session dengan **tiket JWT 60 detik**
  (`scope: terminal`) dan mengirimnya di `socket.handshake.auth` bersama `cols/rows`. Gateway juga menolak `Origin` ≠ `WEB_ORIGIN`.
- Shell di-kill saat socket putus. `main.ts` mengaktifkan CORS untuk `WEB_ORIGIN` karena ada klien browser langsung.
- Hanya role `owner`/`admin` (`TERMINAL_ROLES`): dicek saat membuat tiket (403) dan lagi di gateway dari `role` di payload tiket. Tiket sekali pakai (`jti`, in-memory).
- Ini setara remote shell di host — hanya untuk lingkungan dev/self-hosted yang dipercaya. Host key SSH belum diverifikasi.

## Console container

- Beda dari Terminal (shell di **host** lewat SSH): Console (`src/modules/application/console.gateway.ts`, namespace `/console`) adalah `docker exec -it` masuk ke
  **container aplikasi itu sendiri**, lewat Docker Engine API — bukan SSH sama sekali. `DockerEngineClient.execTty()` (`docker-engine.client.ts`): `POST /containers/{id}/exec`
  dengan `Tty: true` lalu `POST /exec/{id}/start` di-**hijack** (`Connection: Upgrade`/`Upgrade: tcp`, sesuai docs.docker.com/reference/api/engine/ "Hijacking") lewat method privat
  `hijack()` yang mendengarkan event `'upgrade'` Node `http.request` untuk mengambil socket duplex mentah — TTY mode tidak punya frame header 8-byte seperti `exec`/`execWithCode`
  biasa, jadi stdout/stderr sudah byte polos. **Transport-agnostic otomatis**: `hijack()` memakai `this.connection` yang sama dengan seluruh client (socket lokal atau
  `SshDockerAgent`/`docker system dial-stdio` untuk server remote) — tidak ada kode terpisah untuk app di server remote, karena `http.request` memperlakukan event `'upgrade'`
  sama persis apa pun transportnya. `resizeExec()` = `POST /exec/{id}/resize?h=&w=`; `execExitCode()` = `GET /exec/{id}/json` setelah socket `close` untuk `ExitCode`.
- Shell: `sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'` (`SHELL_DETECT_CMD` di `console.gateway.ts`) — coba bash dulu (nyaman), fallback ke sh (hampir selalu ada).
  **Diuji nyata**: container `debian:bookworm-slim` (bash) dan `alpine` (sh saja) dua-duanya kepilih shell yang benar; `registry.k8s.io/pause:3.9` (image scratch tanpa shell
  sama sekali, tapi tetap berjalan selamanya — pengganti "distroless" yang bisa di-`docker run` tanpa command) meng-hijack **berhasil**, lalu daemon sendiri yang menstream
  pesan `OCI runtime exec failed: ... executable file not found` sebagai output terminal biasa sebelum keluar kode 127 — **bukan** event `error` yang diterjemahkan;
  ini disengaja dibiarkan apa adanya karena persis begitu juga tampilannya di `docker exec -it` CLI sungguhan. `describeExecError()` tetap ada sebagai jaring pengaman untuk
  kasus daemon menolak **sebelum** hijack (container berhenti → pesan "is not running", diuji nyata dengan container yang di-stop).
- **Tiket** (`create-console-ticket/`, `POST /applications/:id/console-ticket`, throttle 20/menit): berbeda dari `log-ticket`, tiket ini **mengikat container id yang sudah
  di-resolve** ke payload (`ConsoleTicketPayload.containerId`) — bukan hanya `applicationId` — supaya handshake socket tidak pernah bisa memilih container sendiri, pola yang
  sama dengan `serverId` di tiket terminal. Mode `container` → `RemoteDockerService.forServer(app.serverId).findContainerByName(containerNameFor(app))`, harus `State ===
  'running'` atau 400. Mode `service` (swarm) → `SwarmDeployService.taskContainers(app)` (task **di node ini saja**, lihat bagian Docker Swarm); tanpa `containerId` di body →
  task terbaru (indeks 0, sudah diurutkan `taskContainers()`); dengan `containerId` → divalidasi harus ada di daftar task saat ini, kalau tidak 400.
  **Kontrol akses gratis dari infrastruktur yang sudah ada, tanpa kode baru**: route ini **sengaja tidak** ditambahkan ke `READ_ONLY_POSTS` di `request-context.ts` (yang
  hanya berisi `/log-ticket`) — jadi `isWriteRequest()` menganggapnya tulis, dan `ProjectAccessService.assertAccess()` (dipanggil via `ApplicationService.findOwnedOrFail`)
  otomatis menolak `viewer` dengan 403; `JwtAuthGuard` otomatis menolak token API `readOnly` dengan 403 juga (mekanisme yang persis sama dengan endpoint tulis lainnya).
  Developer/admin/owner lolos. Karena request ini sampai ke handler (bukan ditolak guard), **audit log mencatatnya otomatis** lewat `AuditLogInterceptor` yang sudah ada
  (`action: "POST /applications/:id/console-ticket"`, status 200/403, aktor, tanpa kode tambahan) — diuji nyata: viewer 403 tercatat, token readOnly 403 **tidak** tercatat
  (ditolak di guard, konsisten dengan aturan "guard yang menolak tidak tercatat" di bagian Auth → API token).
- `ConsoleGateway` meniru pola `TerminalGateway` persis: `usedTickets` Map in-memory (tiket sekali pakai), cek `Origin` ≠ `WEB_ORIGIN` → tolak, event protokol
  (`input`/`resize`/`output`/`exit`/`error`) identik. `console.protocol.ts` (dicermin di web `features/console/console.protocol.ts`). Exec di-`destroy()` saat socket
  Socket.IO putus (`handleDisconnect`); container yang mati/exec yang berakhir mengirim `exit` dengan kode dari `execExitCode()` lalu men-disconnect socket.
- **Diuji end-to-end lewat HTTP + WebSocket sungguhan** (bukan cuma `DockerEngineClient` sendirian): sign-in sungguhan → buat tiket via `POST .../console-ticket` →
  connect `socket.io-client` ke `/console` dengan tiket itu → kirim `input`, terima `output` (echo shell asli) → `resize` → `exit 0` → event `exit` kode 0. Juga: origin
  salah ditolak, tiket dipakai dua kali ditolak di percobaan kedua, token API `readOnly` 403, project `viewer` 403, `developer` 200 — semua terhadap akun & tiket asli,
  bukan mock.
- **Belum diuji independen di sesi ini**: server remote sungguhan (SSH) dan cluster Swarm sungguhan untuk fitur ini spesifik — mekanisme hijack sendiri transport-agnostic
  by construction (sama `this.connection` yang dipakai build/push/exec lain yang **sudah** diuji lewat SSH di bagian lain AGENTS ini), tapi kombinasi penuh
  "console ke task swarm di server remote" belum dicoba end-to-end lewat VPS/cluster sungguhan — sarankan smoke test manual sebelum production.

## Prinsip

- Selalu ikuti dokumentasi resmi framework/library (NestJS, TypeORM, dll.) untuk pemilihan paket dan pola kode.

## Docker / distribusi

- `Dockerfile` (multi-stage, `node:24-bookworm-slim` — bukan alpine, karena `node-pty` perlu glibc dan terminal butuh bash).
  Image berjalan sebagai user `node`, `DB_MIGRATIONS_RUN=true` → migrasi dijalankan TypeORM saat boot (`migrationsRun`).
- Semua container yang dibuat API (registry, proxy, app) diberi label `com.docker.compose.project=aoox` (`composeLabels()` di `docker.service.ts`)
  dan kedua compose file memakai `name: aoox`, sehingga Docker Desktop menampilkannya sebagai satu grup. Volume dev Postgres dipin ke nama lama `aoox-api_postgres_data`.
- `docker-compose.yml` = Postgres untuk dev saja. `docker-compose.dist.yml` = stack distribusi (postgres + api + web, image `hideandseeklab/aoox-api`/`aoox-web` dari Docker Hub; `-f docker-compose.build.yml` untuk build lokal dari `../aoox-web`);
  konfigurasi lewat `.env.dist` (contoh: `.env.dist.example`). `POSTGRES_PASSWORD` dan `JWT_SECRET` wajib, tanpa default.
- Tes cold start: `docker compose -p x -f docker-compose.dist.yml --env-file .env.dist down -v && ... up -d --build`, lalu buka `/setup`.
- **`docker-compose.dist.yml` dan `docker-compose.domain.yml` punya salinan ter-bundle di `../aoox-cli/assets/install/`**,
  dipakai `aoox install` untuk bootstrap VPS baru (bundled, bukan `curl` dari GitHub saat instalasi — versi compose selalu selaras dengan versi CLI yang dipasang, tanpa hop jaringan tambahan).
  **Kalau salah satu file ini berubah, salin ulang ke sana** (tanpa itu `aoox install` memasang stack basi) — dicatat juga di
  `assets/install/README.md` di sisi CLI, dan `install-env.ts` di sana punya tes yang gagal kalau ada `${VAR}` baru di compose
  yang belum ditulis ke `.env.dist`-nya.

## Tes & CI

- `npm test` — unit spec (Jest) untuk invarian penting: `setup` hanya saat kosong, bootstrap idempotent, gateway menolak tiket salah/role member/tiket bekas, throttle 429.
  Spec baru diletakkan di samping file yang diuji (`*.spec.ts`), mock repo/DataSource — tidak perlu Postgres.
- CI GitHub: `.github/workflows/ci.yml` menjalankan lint/build/test di tiap pull request dan push ke main; `docker-publish.yml` menerbitkan image ke Docker Hub pada tag versi (config GitLab CI lama sudah dihapus setelah repo pindah ke GitHub).
  `docker-compose.dist.yml` memakai image Docker Hub (`API_IMAGE`/`WEB_IMAGE` untuk pin versi, lihat `.env.dist.example`); `docker-compose.build.yml` untuk build lokal.

## Docker & Registry

- `src/modules/docker/docker-engine.client.ts` — klien **buatan sendiri** untuk Docker Engine HTTP API (`http.request` dengan `socketPath`, versi API dipin `v1.44`,
  demultiplex stream exec). Tanpa library pihak ketiga (user tidak mau dockerode). `docker.service.ts` membungkusnya (`DOCKER_SOCKET`; default `/var/run/docker.sock`, Windows `//./pipe/docker_engine`).
  Tambahkan endpoint baru ke klien mengikuti spec resmi (https://docs.docker.com/reference/api/engine/).
  Di dist compose socket di-mount dan `group_add: DOCKER_GID` karena container berjalan sebagai `node`.
- **Rotasi log**: `docker/log-config.ts` `logConfig(env)` (pure, di-unit-test) → `HostConfig.LogConfig` `json-file` `max-size`/`max-file` dari `CONTAINER_LOG_MAX_SIZE` (default `10m`,
  `off` = default Docker tanpa batas) / `CONTAINER_LOG_MAX_FILE` (3), tersedia sebagai `DockerService.logConfig` dan dipasang di semua container jangka panjang: app & preview
  (`replaceContainer`), managed DB (`provision`), proxy, registry — juga di server remote (kebijakan dari panel). Berlaku saat container **dibuat ulang** (deploy/apply config/provision ulang);
  container lama tetap tanpa batas sampai itu. Helper sekali-jalan tidak diberi (umur pendek). Stack compose tidak dijangkau (`logging:` di file compose atau `log-opts` daemon).
  `docker-compose.dist.yml` memakai anchor `x-logging` yang sama untuk postgres/api/web.
- `src/modules/registry/` — entity `Registry` (`self-hosted` | `external`, password AES-256-GCM dengan `ENCRYPTION_KEY`, `select: false`).
  `self-hosted-registry.service.ts` menjalankan `registry:3` (htpasswd bcrypt via container sekali jalan, volume `aoox_registry_{data,auth}`,
  `REGISTRY_STORAGE_DELETE_ENABLED=true`). `registry-client.ts` = OCI Distribution API v2 (catalog, tags, manifest digest, delete).
- Flow: `create-registry/`, `list-registries/`, `delete-registry/`, `test-registry/`, `provision-self-hosted/`, `remove-self-hosted/`,
  `self-hosted-status/`, `list-repositories/`, `list-tags/`, `delete-tag/`, `garbage-collect/`, `set-registry-domain/`. Manajemen = `@Roles('owner','admin')` (`RolesGuard`), provisioning/GC = owner.
- **Domain kustom untuk registry lokal** (`set-registry-domain/`, `PATCH /registries/:id/domain`, `@Roles('owner','admin')`, hanya untuk `type: 'self-hosted'`): registry sebelumnya
  sama sekali tidak terhubung ke Traefik (murni port host, HTTP polos, TLS/`insecure-registries` sepenuhnya tanggung jawab operator). Sekarang bisa direcreate dengan label
  `ProxyService.buildLabels('aoox-registry', 5000, [{host, https:true}], ...)` (dipakai langsung sebagai static method, pola sama dengan `panel-domain.util.ts`) dan join network
  `aoox` (`APP_NETWORK`) — mensyaratkan proxy sudah `running` **dan** `acmeEmail` terisi (400 kalau belum, karena tanpa ACME sertifikat default Traefik tidak dipercaya `docker push`).
  `SelfHostedRegistryService.createContainer()` (private, dipakai `provision()` dan `setDomain()`) selalu `ensureNetwork(APP_NETWORK)` + `NetworkMode: APP_NETWORK` sekarang —
  port host tetap dipublikasikan juga, jadi akses IP:port tidak hilang. Set domain → `registry.domain` + `registry.url` (jadi domain polos tanpa port, HTTPS standar) diperbarui
  di DB; hapus domain (`domain: null`) → recreate tanpa label, `url` kembali ke `SelfHostedRegistryService.publicUrl`. Volume data & auth (htpasswd) tidak tersentuh saat recreate,
  jadi kredensial tetap sama. `apiBaseUrl()` (panggilan API sendiri ke registry) tidak berubah — tetap lewat `REGISTRY_INTERNAL_URL`, tidak pernah lewat domain publik. CLI:
  `aoox registry domain --set <host>` / `--clear` (cari registry `self-hosted` otomatis, tidak perlu id). Dashboard: field "Domain kustom" di kartu Registry lokal.
  Efek samping yang diinginkan: `SwarmStatus.registry.reachableFromNodes` (cek regex `registry.url` bukan `localhost`) otomatis jadi `true` begitu domain aktif, tanpa perlu ubah
  `swarm.service.ts` sama sekali.
- **Storage S3 opsional untuk registry lokal** (`Registry.storageDestinationId`, FK `backup_destinations` `SET NULL`, hanya diisi saat provisioning — tidak bisa diganti tanpa
  hapus+provision ulang): default tetap disk lokal (volume `aoox_registry_data`) seperti sebelumnya; kalau `POST /registries/self-hosted` diberi `destinationId`, reuse kredensial
  `BackupDestination` yang sama dipakai backup database/volume (`BackupDestinationService.resolve()`) dan set driver storage image `registry:3` ke S3 lewat
  `registry-s3-env.ts` (`registryS3Env()`, pure & di-unit-test — `REGISTRY_STORAGE=s3` + `REGISTRY_STORAGE_S3_{ACCESSKEY,SECRETKEY,REGION,BUCKET,SECURE,FORCEPATHSTYLE}`,
  `REGIONENDPOINT` hanya kalau ada endpoint kustom/MinIO, `ROOTDIRECTORY` dari `prefix`). Volume data (`aoox_registry_data`) **tidak dibuat/di-mount sama sekali** saat pakai S3 —
  cuma volume auth (htpasswd) yang tetap lokal, karena autentikasi bukan "data registry". `createContainer()` (dipakai `provision()` **dan** `setDomain()`) menerima
  `destination: DestinationConfig | null` di kedua tempat supaya ganti domain tidak "lupa" backend S3 yang sudah dipilih — `SetRegistryDomainService` resolve ulang
  `registry.storageDestinationId` sebelum recreate. Dashboard: pilihan "Lokal" vs tujuan S3 di dialog konfirmasi sebelum tombol Provision (tidak bisa diubah setelahnya dari UI).
  Belum: migrasi data dari lokal ke S3 (atau sebaliknya) untuk registry yang sudah terlanjur di-provision.
- Route dengan nama repo bergaris miring memakai wildcard Express 5 (`*repository`) yang tiba sebagai array → di-`@Transform` jadi string di DTO.
- Hapus tag = hapus manifest (tag lain dengan digest sama ikut hilang); disk kembali setelah GC.
- **Hapus image sepenuhnya** (`delete-repository/`, `DELETE /registries/:id/repositories/*repository?force=`, `@Roles('owner','admin')` — sama dengan `delete-tag`, karena secara efek
  ini "delete-tag berkali-kali" ditambah pembersihan folder, bukan operasi seberat GC registry-wide yang owner-only): ditemukan user di VPS bahwa setelah semua tag sebuah repo dihapus
  **dan** GC dijalankan, repo seperti `dummy/hello` tetap muncul di `_catalog` dengan "0 tag" — penyebabnya, `registry:3` membangun `_catalog` dari nama folder
  `docker/registry/v2/repositories/<repo>/` di storage, dan **baik Distribution API maupun garbage-collect tidak pernah menghapus folder itu sendiri**, hanya blob/manifest tak terpakai
  di dalamnya. Distribution API juga tidak punya endpoint "hapus repo". Alurnya: (1) `listTagNames` + `getTag` per tag untuk kumpulan digest unik (tag berbeda bisa berbagi digest,
  seperti `delete-tag`) → `deleteManifest` per digest; (2) hapus foldernya — lokal lewat helper busybox sekali-jalan (`SelfHostedRegistryService.removeRepositoryData()`, `Cmd` array
  `['rm','-rf', path]`, **tanpa shell** jadi nama repo tidak pernah lewat interpolasi shell) atau S3 lewat `BackupDestinationService.purgeDir()` (rclone `purge` ke
  `<ROOTDIRECTORY>/docker/registry/v2/repositories/<repo>`, method baru — sebelumnya cuma ada `remove()` satu file); (3) `garbageCollect(false)` otomatis; (4) `restartRegistry()`
  (method baru di `DockerEngineClient`, `POST /containers/{id}/restart`). Nama repo divalidasi dua kali: `@Matches` yang sama dengan `delete-tag` di DTO, **dan** lagi
  `assertValidRepositoryName()` (`repository-name.ts`, di-unit-test) tepat sebelum dipakai membangun path/`Cmd` — menolak `..`, path absolut, dan apa pun di luar bentuk komponen OCI,
  sebagai lapis kedua yang sengaja terpisah dari validasi DTO.
  **Jebakan cache blob descriptor**: `registry:3` defaultnya (tanpa env apa pun, tidak pernah di-nonaktifkan di `createContainer()`) mengaktifkan `storage.cache.blobdescriptor: inmemory`
  — setelah GC menghapus blob, cache di memori itu masih percaya blob itu ada, jadi `docker push` ulang layer yang sama berikutnya melihat "blob already exists" dan **tidak**
  mengunggah ulang, padahal blobnya sudah hilang dari disk; manifest baru lalu menunjuk ke blob yang tidak ada dan `docker pull` gagal. Dipilih **restart container** setelah GC
  (cache in-memory, hilang begitu proses baru) daripada mematikan cache-nya — lebih aman dan tidak mengubah perilaku registry di luar momen hapus-image ini. Diuji nyata dengan
  `registry:3` sungguhan: push 2 repo (satu dengan 2 tag berdigest sama plus repo lain yang berbagi blob yang sama lewat `--mount`), hapus salah satu repo → hilang dari `_catalog`,
  repo lain utuh, GC melaporkan blob yang benar-benar tidak dipakai lagi (3 blob) sementara blob yang masih dipakai repo lain tidak disentuh (0 blob) — lalu build image baru yang
  blobnya **benar-benar** ter-GC, hapus repo-nya, **push ulang** persis konten yang sama dan **pull** hasilnya: berhasil penuh (membuktikan jebakan cache di atas benar dan restart
  menyelesaikannya). Juga diuji: repo 0-tag persis skenario user (hapus tag lalu hapus repo, hilang dari katalog), registry eksternal ditolak 400, token API `readOnly` 403.
  **Peringatan pemakaian**: sebelum menghapus (kecuali `?force=true`), `usage()` mencari `Application.currentImage`/`imageRef` yang cocok pola `%/<repo>:%` dan membalas 409 dengan
  daftarnya (juga tersedia sendiri lewat `GET .../repositories/*repository/usage` untuk pratinjau di web sebelum konfirmasi) — diuji nyata dengan aplikasi `sourceType: 'image'`
  yang `imageRef`-nya menunjuk repo yang mau dihapus: 409 tanpa `force`, 200 dengan `force=true`. **Belum diuji**: S3 (tidak ada MinIO di lingkungan pengujian ini; kode `purgeDir()`
  memakai ulang `rcloneEnv()`/pola `rclone` yang sudah diuji nyata di tempat lain untuk upload/download/delete, hanya perintah `purge` yang baru).
- **Jebakan ditemukan saat mengerjakan fitur di atas**: `RegistryService.apiBaseUrl()` memakai `config.get('REGISTRY_INTERNAL_URL') ?? fallback` — `.env`'s
  `REGISTRY_INTERNAL_URL=` (kosong, bukan dihapus) adalah string kosong, bukan `undefined`, jadi `??` **tidak** jatuh ke fallback dan `RegistryClient` dibuat dengan `baseUrl` kosong,
  membuat **setiap** panggilan lewat `RegistryClient` (`list-repositories`, `list-tags`, `delete-tag`, `test-registry`, dan fitur hapus-image di atas) gagal 500 `Invalid URL` —
  pola yang persis sama dengan jebakan `DOCKER_SOCKET` yang sudah didokumentasikan (bagian Docker & Registry, klien Engine API). Ditemukan lewat verifikasi nyata dev server di sesi
  ini (bukan lewat unit test — mock tidak pernah membaca `.env` sungguhan), diperbaiki dengan mengganti `??` jadi `||` di `apiBaseUrl()`.
- **Kredensial untuk klien luar** (`get-registry-credentials/`, `GET /registries/:id/credentials`, `@Roles('owner','admin')` — sama dengan `delete-registry`): membalas `{url, username, password}` dengan password **terdekripsi**, pola yang sama dengan `database-credentials` (dipisah dari `GET /registries` supaya list tidak pernah membawa rahasia). Dipakai `aoox deploy` di CLI (`../aoox-cli`) untuk `docker login` sebelum `docker push` — `url` di sini APA ADANYA dari kolom `registries.url` (untuk registry self-hosted = `SelfHostedRegistryService.publicUrl`, sudah menghormati `REGISTRY_PUBLIC_HOST`), bukan `apiBaseUrl()` yang dipakai API sendiri untuk memanggil registry (itu bisa `REGISTRY_INTERNAL_URL`, tidak terjangkau dari luar container API).

## Application & Deploy

- `src/modules/application/` — entity `Application` (di bawah `Project`, `app_name` slug unik → nama container `aoox-app-<appName>`,
  sumber: `git_url`+`git_branch`+`dockerfile_path`, `container_port`, `host_port` nullable, `env` teks `KEY=VALUE`) dan `Deployment`
  (`status` queued→building→pushing→starting→success|failed, `image_ref`, `logs` teks, `error_message`, `finished_at`).
- Kepemilikan lewat project: `ApplicationService.findOwnedOrFail(id, ownerId)` join `project.ownerId`.
- Flow: `create/list/get/update/delete-application`, `deploy-application` (202, tolak 409 kalau masih ada deployment aktif),
  `list-deployments` (tanpa logs), `get-deployment` (dengan logs, di-poll web), `stop/start-application`, `application-logs` (log container).
  `list-applications` (`GET /applications?projectId=`) membalas app + `domains: [{host, https}]` (satu query `IN (...)` untuk seluruh daftar, bukan per app) supaya kartu
  halaman detail project bisa menautkan ke app yang berjalan; compose (`serviceDomains`/`servicePorts`) dan database (`hostPort`) sudah ada di row list masing-masing.
- **Cek tabrakan host port** saat `create`/`update-application` men-set `hostPort`: `HostPortService` (`src/modules/host-port/`, hanya meng-impor entity
  `Application`/`ManagedDatabase`/`ComposeApp` langsung — bukan module-nya — supaya bisa dipakai `ApplicationModule` **dan** `ComposeModule` tanpa siklus,
  karena `ComposeModule` sudah meng-import `ApplicationModule`). Logika sama dengan `ComposeService.assertHostPortsFree()` (lihat bagian Compose): `applications.host_port`
  lain, `managed_databases.host_port`, `service_ports` compose, dan port yang sedang di-bind container di daemon. App di server remote (`Application.serverId`) mengecek
  container lewat `RemoteDockerService.forServer(serverId)`, bukan daemon lokal — cek tabel tetap global. Saat `update`, container milik app sendiri (`aoox-app-<appName>`,
  `-next` blue/green, atau task swarm berlabel `aoox.application`) dan baris app itu sendiri dikecualikan; cek hanya jalan kalau `hostPort` atau `serverId` berubah.
  Sebelumnya app yang dibuat tanpa domain **dan** tanpa host port bebas dipilih port yang sudah dipakai lalu gagal diam-diam saat container dibuat — sekarang 400 di awal.
- **Ubah Port host pada app yang sudah jalan berlaku langsung** (`update-application.service.ts`): port hanya hidup di `HostConfig.PortBindings` container, jadi dulu PATCH cuma menyimpan
  baris DB dan port baru baru terbuka setelah deploy/rollback berikutnya. Sekarang `hostPort` berubah (null→angka, angka→angka, angka→null) + `currentImage` + `status==='running'` →
  `runner.applyRuntimeConfig` (mode container: sinkron, recreate dari `currentImage`, tanpa build; dengan port host **tidak ada blue/green** karena dua container tak bisa bind port yang sama
  → downtime singkat; server remote lewat `RemoteDockerService.forServer` di dalam `replaceContainer`) atau `queueRuntimeConfig` (mode service — rolling update). **Aplikasi `stopped` tidak
  dinyalakan**: hanya disimpan, dan `start-application` membandingkan `HostConfig.PortBindings[<containerPort>/tcp]` container yang berhenti dengan `app.hostPort` (`publishedPort()`) — beda →
  cek `assertFree` lalu `applyRuntimeConfig` (recreate + start) alih-alih `startContainer` (container berhenti masih membawa port lamanya). Mode service yang di-scale 0 belum punya jalur ini
  (berlaku pada deploy/config berikutnya). **Deployment aktif → 409** (bukan "biarkan deployment membacanya"): runner memegang salinan entity `Application` dari saat di-queue, jadi ia
  membuat container dengan port lama **dan** `repo.save(app)` di akhir menulis balik port lama, menghapus perubahan user diam-diam (TypeORM men-diff terhadap DB). **Kegagalan penerapan**:
  `replaceContainer` menghapus container lama *sebelum* membuat yang baru (port yang sama), jadi bila create/start gagal (port direbut proses lain setelah `assertFree`) tak ada container tersisa;
  `applyHostPort()` lalu mengembalikan `hostPort` lama di DB **dan** me-recreate container dengan port lama, dan membalas 409 "…the previous port was restored" (bila restore ikut gagal →
  status `error` + pesan "redeploy"). Diuji nyata dengan `nginx:alpine` (sumber image): tambah/ganti/hapus port mengikuti tanpa deployment baru, bentrok dengan container lain 400 dan container
  utuh, stopped tetap stopped lalu start memakai port baru, deployment aktif 409. **Belum diuji nyata**: jalur restore saat gagal (Docker Desktop tidak menolak bind meski Windows menahan
  port atau port dikecualikan — hanya tes unit), server remote, swarm.
- `deployment-runner.service.ts` berjalan **detached** dari request: `POST /build?remote=<git>#<branch>` (daemon meng-clone sendiri — tidak butuh git/tar di API)
  → `POST /images/{name}/push` dengan `X-Registry-Auth` (base64url **dengan padding**, seperti Go) ke registry lokal
  → hapus container lama → create+start container baru (label `aoox.application`). Image ref: `<registry.url>/<project-slug>/<appName>:<12 char id deployment>`.
  Selalu berakhir `success`/`failed`; gagal build/push tidak menyentuh container yang sedang jalan dan tidak mengubah `status` app.
- Log realtime: `logs.gateway.ts` (Socket.IO namespace `/logs`, tiket 60 detik dari `create-log-ticket/` = `POST /applications/:id/log-ticket`, scope `logs`, terikat satu aplikasi).
  Event klien `subscribe:deployment(id)` / `subscribe:container(tail)` / `unsubscribe`; server `deployment:log` (`snapshot: true` = teks penuh, selain itu append),
  `deployment:status`, `container:log`, `container:end`. Runner memancarkan chunk lewat `DeploymentEventsService` (EventEmitter in-process + teks live per deployment
  untuk snapshot sinkron tanpa duplikasi); DB tetap di-flush tiap ~1 detik sebagai penyimpanan. Log container via `followContainerLogs` (`GET /containers/{id}/logs?follow=1`, `StreamDemuxer`).
  Satu instance API saja — kalau di-scale, ganti emitter dengan Redis pub/sub.
  Selain langganan per-deployment, tiap socket juga `join()` room `app:<applicationId>` saat handshake (di `handleConnection`, dari `applicationId` tiket) — dipakai
  event `deployment:created` (di bawah) yang harus sampai ke **semua** socket terhubung ke aplikasi itu, bukan cuma yang sedang subscribe ke satu deployment tertentu.
- **Asal pemicu deployment** (`Deployment.trigger`: `manual`|`webhook`|`auto-update`, terpisah dari `kind` yang memilih jalur build/rollback/config — `rollback`/`config`
  selalu `trigger: 'manual'`, `triggeredBy` yang membedakannya dari deploy manual biasa) + `commitSha`/`commitMessage` (dipotong ke baris pertama, 200 char) +
  `triggeredBy` (email aktor untuk manual/rollback/config — dari `@CurrentUser()`, sama untuk sesi maupun API token; nama pusher untuk webhook). Diisi di titik
  pembuatan row: `DeployApplicationService.queue(app, kind, info?)` (manual & auto-update lewat `execute()`/`ImageUpdateWatcherService`, default trigger dari `kind`),
  `WebhookDeployService` (dari `parsePushCommit()` — GitHub `after`/`head_commit.message`/`pusher.name`, GitLab `checkout_sha`/`commits[].message` terakhir/`user_name`),
  `RollbackApplicationService`, `DeploymentRunnerService.queueRuntimeConfig()`. Baris pertama log deployment juga menyebutkannya (`triggerSummary()`, pure & di-unit-test,
  mis. `==> Triggered by webhook (a1b2c3d "fix x" by octocat)`) via `DeploymentLog.note()` (seperti `step()` tapi tanpa ganti status) — redaksi token/password tetap berlaku
  karena lewat `append()` yang sama. Diekspos di `list-deployments`/`get-deployment` (field baru ditambahkan ke `select` eksplisit `list-deployments`, `get-deployment`
  sudah membalas row penuh).
- **`deployment:created`** (event baru `LogsServerEvents`, dipancarkan `DeploymentEventsService.emitCreated()`/`onCreated()`): `DeploymentRunnerService.start()` —
  satu-satunya titik yang dipanggil oleh **semua** jalur pembuatan deployment (build/webhook/auto-update lewat `queue()`, rollback/config lewat `start()` langsung) —
  memancarkannya sekali per row, sehingga tidak perlu duplikasi di tiap caller. `LogsGateway` meneruskannya ke room `app:<applicationId>` (`server.to(room).emit(...)`,
  `@WebSocketServer()`), bukan ke satu socket yang sedang subscribe — jadi tab yang sedang terbuka tahu ada deploy baru (webhook, auto-update, user lain) tanpa
  refresh manual. Payload `{id, trigger, commitSha, commitMessage, triggeredBy}`.
- **Health check & zero-downtime** (`Application.healthcheckPath`, mis. `/health`; `healthcheck.ts`): container dibuat dengan Docker `HEALTHCHECK` (`CMD-SHELL` yang mencoba
  `wget` → `curl` → `node -e fetch` → `python3` ke `127.0.0.1:<containerPort><path>`, interval 3 s, 30 retry; exit 127 = tidak ada satu pun → pesan error menyebutkannya).
  `replaceContainer` menunggu `State.Health.Status === 'healthy'` (`waitHealthy`, poll `healthPollMs`) sebelum deployment dianggap sukses. Untuk app yang dirutekan lewat
  domain **tanpa port host** (dan bukan preview) dilakukan **blue/green**: container baru bernama `<name>-next` dengan label Traefik yang sama — provider docker Traefik
  mengabaikan container yang belum `healthy`, lalu me-load-balance keduanya — setelah sehat tunggu `proxySettleMs` (3 s, agar Traefik sempat menambah server), hapus yang lama,
  `renameContainer` `-next` → nama asli (diuji: 80/80 request 200 selama swap). Gagal/timeout → `-next` dihapus, container lama tetap melayani, deployment `failed`.
  Dengan port host (dua container tak bisa bind port yang sama) atau preview: replace biasa, health check tetap menentukan sukses/gagal. `-next` sisa deploy yang crash dihapus dulu.
  Efek samping yang disengaja: container yang kemudian jadi `unhealthy` dilepas Traefik (404) — itulah gunanya health check.
- Rollback: `rollback-application/` (`POST /applications/:id/rollback {deploymentId}`) membuat Deployment `kind: 'rollback'` yang memakai `imageRef` lama
  (`ensureImage` → `replaceContainer`), tanpa build/push. Hanya target `success` yang boleh.
- `Application.ignoreErrorLogs` (default `false`, diset lewat `update-application`): melewatkan app dari `app-error-watcher.service.ts` (lihat bagian
  Notifikasi → "Error aplikasi dari log") — untuk app yang output normalnya memang berisik terlihat seperti error. Ikut diekspor/impor lewat `project-transfer`.
- Environment: `Project.env` (bersama) + `Application.env`, keduanya teks `KEY=VALUE`; digabung oleh `env-resolver.service.ts` **saat container dibuat**
  (`replaceContainer`, bukan saat build — jadi password DB baru/rotasi terpakai di deploy berikutnya tanpa rebuild), app menang bila key sama.
  Nilai boleh merujuk `${{project.KEY}}` dan `${{database.<slug>.url|host|port|username|password|database}}` — database dicari **hanya di project yang sama**
  (slug global, jadi tanpa filter ini app bisa membaca password project lain). Referensi tak dikenal → `EnvReferenceError`: 400 saat `update-application`
  (divalidasi di sana), atau deployment `failed` bila baru salah saat deploy. Password DB yang ter-resolve didaftarkan ke `DeploymentLog.redact`.
  `Application.buildArgs` (`KEY=VALUE`) → `buildargs` JSON di `POST /build` — literal, tanpa referensi, karena ikut tersimpan di image yang di-push.
- **Nixpacks** (`Application.buildType` `dockerfile`|`nixpacks`, `nixpacks-builder.service.ts`): repo tanpa Dockerfile. Tanpa binary di host/image API:
  (1) helper image `aoox-nixpacks:<versi>` (debian + git + CLI nixpacks dari GitHub release, `HELPER_DOCKERFILE`) dibangun sekali lewat `POST /build`
  dengan konteks tar satu file (`tarSingleFile`, ustar minimal); (2) container helper sekali-jalan `git clone --depth 1` (URL berkredensial tidak pernah keluar dari
  helper; `GIT_TERMINAL_PROMPT=0`) lalu `nixpacks build /src --out /src --no-cache --env K=V` — hanya menulis `.nixpacks/Dockerfile`, tanpa docker; `tar` seluruh
  source → `readFileFromContainer` (archive API) → (3) `buildFromTar` (`POST /build` body `application/x-tar`, `dockerfile=.nixpacks/Dockerfile`, builder klasik).
  `--no-cache` **wajib**: cache mount nixpacks adalah sintaks BuildKit (`RUN --mount`), dan `POST /build?version=2` butuh sesi gRPC BuildKit yang tidak dimiliki klien
  buatan sendiri (diuji: tanpa flag build menggantung). Konsekuensi: tidak ada cache dependensi antar build, build pertama lambat (base `ghcr.io/railwayapp/nixpacks:ubuntu-*`
  ±350 MB + `nix-env`), konteks tar ditahan di memori (source tree saja, `.git` dihapus). `buildArgs` → `--env` nixpacks (mis. `NIXPACKS_NODE_VERSION`) dan `buildargs` Docker.
  Versi nixpacks dipin `NIXPACKS_VERSION`; naikkan = helper image baru otomatis. `aoox.component=build` untuk helper (diabaikan monitoring/container-down karena bukan app/db).
- **Mounts** (`mount.entity.ts`, tabel `mounts`, unik per `application_id`+`container_path`): `volume` (volume Docker `aoox_app_<appName>_<name>`, data bertahan antar deploy),
  `bind` (path host — **hanya owner/admin**, `BIND_MOUNT_ROLES`, karena setara akses filesystem host), `file` (isi di kolom `content`, selalu read-only). `mounts.ts`:
  `bindsFor()` (pure, di-unit-test) → `HostConfig.Binds`; `prepareMounts()` membuat volume dan menulis semua `file` ke volume `aoox_app_<appName>_files` lewat
  helper busybox yang **tidak dijalankan** (`putArchive` ke container stopped), lalu file di-bind dari `inspectVolume().Mountpoint` — API v1.44 belum punya volume subpath,
  jadi trik yang sama dengan compose runner. Flow `add/list/update/delete-mount` (`/applications/:id/mounts[/:mountId]`, `?purge=true` menghapus volume) semuanya
  memanggil `applyRuntimeConfig` (recreate container tanpa build). Preview PR **tidak** mendapat mount (jangan berbagi volume prod dengan branch sembarang).
  Blue/green: dua container sementara memakai volume yang sama — konsekuensi yang diterima.
  **Mount database**: `Mount.databaseId` (nullable; unik per `database_id`+`container_path`), helper `mounts.ts` menerima `MountOwner` (`{appName}` → `aoox_app_…`,
  `{slug}` → `aoox_db_…`). `ManagedDatabaseService.provision()` menambahkan `bindsFor()` dari mount DB (repo `Mount` di-`forFeature` di module DB juga — ApplicationModule tidak bisa
  di-import ke sana, siklus). Flow di `src/modules/database-mount/` (`/databases/:id/mounts[...]`, memakai `mountFields()` dari add-mount app) — tiap perubahan `provision()` ulang
  (restart singkat; data di volume; DB `stopped` dihentikan lagi).
  **Mount compose** (`Mount.composeAppId` + `Mount.service` — satu stack = N service, jadi mount butuh tahu service mana; unik per `compose_app_id`+`service`+`container_path`;
  FK ke `compose_apps` lewat SQL migrasi murni, **bukan** relasi TypeORM, karena ComposeModule sudah meng-import ApplicationModule — relasi baliknya akan jadi siklus).
  `MountOwner` (`mounts.ts`) jadi tiga arah: `{appName}` → `aoox_app_…`, `{slug,engine}` → `aoox_db_…` (dibedakan dari compose lewat kolom `engine` yang cuma
  dimiliki `ManagedDatabase` — `ComposeApp` juga punya `.slug` tapi tanpa `engine`, jadi tidak bisa tertukar tanpa impor entity yang bikin siklus), `{slug}` → `aoox_compose_…_<service>_…`
  (nama volume **disertakan service**, supaya dua service boleh punya mount bernama sama tanpa tabrakan). Flow `src/modules/compose-mount/` (`/compose-apps/:id/mounts[...]`,
  `AddComposeMountDto extends AddMountDto` mewajibkan `service`) — **tidak** memanggil apa pun sinkron (beda dari app/db): compose bukan satu container yang bisa di-patch,
  jadi mount baru hanya berlaku di deploy berikutnya, sama seperti `serviceDomains`/`serviceResources`.
  Dirender ke override (`renderOverride` di `compose-runner.service.ts`) sebagai `volumes:` bentuk panjang (`{type,source,target,read_only}` — **bukan** string pendek `a:b:ro`,
  karena path daemon-side bisa mengandung karakter yang bentrok dengan pemisah `:`) plus deklarasi top-level `external: true` untuk volume bernama (sudah dibuat sendiri oleh
  `prepareMounts()`, jadi compose tidak boleh mencoba membuatnya lagi) — key deklarasi top-level itu **disertakan service** juga (`<service>_<name>`), bukan cuma nama mount,
  supaya dua service dengan mount bernama sama tidak saling menimpa entri `external`. Mount `file` memakai trik yang sama dengan app/db (bind dari `inspectVolume().Mountpoint`
  files volume) tapi subpath-nya `<service>/<name>` di dalam volume files yang sama (satu volume `_files` untuk seluruh stack).
  **Jebakan yang ditemukan**: `docker compose up -d` idempoten berdasar diff **konfigurasi YAML**, bukan isi file — mengubah `content` mount `file` tidak mengubah override
  (path bind-nya sama), jadi compose menganggap tidak ada perubahan dan **tidak** me-recreate container; container yang sudah jalan tetap terikat ke inode lama (bind mount
  per-file, bukan per-direktori) dan tidak pernah melihat isi baru sampai direstart. Karena itu deploy menambahkan `--force-recreate` ke `up` **hanya** saat stack punya mount
  `file` (mount volume/bind tidak kena masalah ini — path yang dideklarasikan itu sendiri yang berubah, jadi compose sudah otomatis mendeteksinya). Diuji nyata: edit isi file
  mount lalu redeploy tanpa flag ini → isi lama tetap tersaji; dengan flag → "Recreated" di log dan isi baru terlihat. `renderOverride` juga diuji: volume mount tanpa
  domain/port sama sekali (early-return lama hanya mengecek domains/ports, sekarang mounts & resources ikut dicek — kalau lupa, stack dengan mount saja tidak pernah dapat override).
- **Situs statis** (`Application.buildType = 'static'`, `static-site-builder.service.ts`): `renderStaticDockerfile()` (pure, di-unit-test) = stage `node:22-alpine` opsional
  (`staticBuildCommand`, null = file sudah ada) → `nginx:1.27-alpine` menyalin `staticOutputDir` (`dist`/`build`/`out`/`.`) ke `/usr/share/nginx/html`; `renderNginxConf(spa)` =
  gzip, cache aset 7 hari, `try_files … /index.html` bila `staticSpa`. Pipeline = jalur nixpacks tanpa planner: helper `aoox-nixpacks` meng-clone, Dockerfile & nginx.conf
  dimasukkan lewat env (`printf` ke `.aoox/`), tar → `buildFromTar` (`dockerfile=.aoox/Dockerfile`, builder klasik — tanpa cache mount). Port container = 80.
  Diuji: repo HTML polos dan build stage + fallback SPA. Mode non-SPA menyajikan `404.html` milik repo untuk path yang tidak ada (`error_page 404`; tanpa file itu = halaman 404 bawaan nginx). Diuji ulang lewat halaman create baru + deploy nyata: `/` & `/about.html` 200, path tak dikenal 404 dengan halaman kustom. Belum: pnpm/yarn workspace butuh perintah build eksplisit (tidak ada deteksi otomatis).
- **Sumber image** (`Application.sourceType = 'image'`, `image_ref`, `image_registry_id` FK registries SET NULL; `git_url` nullable): runner melewati build/push —
  `pullSourceImage()` selalu `pullImage(ref, auth?)` (tag bergerak ikut terbarui; `X-Registry-Auth` dari kredensial registry eksternal untuk image privat, password di-redact dari log)
  lalu `replaceContainer`. Tidak butuh registry lokal. Pull gagal → deployment `failed`, container lama tetap jalan. Rollback tetap memakai `imageRef` deployment lama; webhook untuk app
  image mengabaikan cek branch (CI bisa memanggilnya setelah `docker push`); preview PR tidak berlaku. DTO: `gitUrl` wajib hanya bila `sourceType !== 'image'` (`ValidateIf`),
  `imageRef` wajib bila `image`. Web: select **Sumber** di form (git/image), field image + kredensial registry.
  **Jebakan yang ditemukan** (`create-application.dto.ts` **dan** `update-application.dto.ts` — keduanya kena, ditemukan terpisah sehari berbeda karena form yang sama
  dipakai untuk create dan update): field milik sumber/cara build yang tidak dipakai (mis. `imageRef` untuk app git, atau `dockerfilePath` untuk `buildType` selain
  `dockerfile`) dikirim web sebagai `""`, bukan `undefined`/`null` — bagian Image/Git/Dockerfile/Static di form React di-mount kondisional per `sourceType`/`buildType`,
  jadi field yang tidak relevan lenyap dari `FormData` dan action mengembalikannya sebagai string kosong. `@IsOptional()` **hanya** melewatkan `null`/`undefined`, bukan
  `""`, sehingga `@Matches(...)` tetap jalan dan menolak string kosong dengan pesan regex-nya (mis. `dockerfilePath must match /^[\w./-]{1,200}$/ regular expression`) —
  user tidak bisa membuat/menyimpan Pengaturan sama sekali untuk cara build yang field-nya sendiri tidak mereka sentuh. Field bertipe string dengan pola serupa (`imageRef`,
  `gitUrl`, `gitBranch`, `dockerfilePath`, `staticOutputDir`, `staticBuildCommand`, `healthcheckPath`, `previewDomain`) butuh `@ValidateIf((_, v) => v !== '')` tambahan
  (di samping `v !== null` untuk yang nullable) supaya `""` dilewatkan seperti `null`/`undefined`, di **kedua** DTO; field UUID nullable (`gitCredentialId`,
  `imageRegistryId`, `swarmNodeId`, `serverId`) aman karena `application.schema.ts` di web sudah men-transform `""` → `null` sebelum dikirim, jadi `ValidateIf(v !== null)`
  yang ada di sana sudah cukup — hanya field string yang divalidasi `@Matches`/regex tanpa transform serupa yang rawan. Service create juga sempat menyimpan `gitUrl`/
  `staticBuildCommand` sebagai `""` alih-alih `null` (pola `?.trim() ?? null` tidak menangkap `""`, beda dari `?.trim() || null` yang dipakai field lain) — disamakan.
  Diaudit juga `compose-app.dto.ts`/`create-compose-app.dto.ts` (pola serupa lain) dan `add-mount.dto.ts`: **tidak** kena — form compose memakai skema zod terpisah per
  `source` (git vs template) yang menghilangkan field tak relevan sepenuhnya (bukan mengirim `""`), dan dialog mount membangun body request sebagai objek JS dengan
  spread kondisional, jadi tidak pernah mengirim field yang bagiannya sendiri tidak dirender.
- **Update otomatis image** (`Application.autoUpdate`, `autoUpdateIntervalMinutes` 5–1440 default 60, `imageDigest`, `imageCheckedAt`; hanya `sourceType='image'`):
  `image-reference.ts` `parseImageRef()` (pure, di-unit-test; Docker Hub → `registry-1.docker.io` + `library/`), `registry/remote-digest.ts` `fetchRemoteDigest()` =
  `HEAD /v2/<repo>/manifests/<tag>` dengan Accept manifest list/OCI index (digest yang sama dengan `docker pull`/`buildx imagetools`), token flow Docker Hub/GHCR
  (401 + `WWW-Authenticate: Bearer` → realm+service+scope, `parseBearerChallenge` di-unit-test) atau Basic (registry self-hosted; base URL & kredensial dari `Registry` bila `imageRegistryId`).
  `ImageDigestService.remoteDigest(app)` dipakai **runner setelah pull** (baseline = digest registri, bukan `RepoDigests` lokal — beda representasi bisa memicu loop redeploy) dan
  `ImageUpdateWatcherService` (`@Cron` tiap menit: app image + `autoUpdate` + `running` yang intervalnya lewat → `check(app, true)`: baseline bila belum ada, `changed` →
  `DeployApplicationService.queue(app, 'auto-update')` (`DeploymentKind` baru; Conflict = ada deployment lain, dilewati); gagal registri tetap menstempel `imageCheckedAt`).
  `POST /applications/:id/check-image {deploy?}` (`check-image-update/`, throttle 30/menit) = cek manual. Ganti `imageRef` di update → `imageDigest` di-null-kan. Referensi `@sha256:` = tidak pernah berubah.
  Diuji: Docker Hub, GHCR, registry lokal (dengan/tanpa kredensial), deploy via cek manual dan via cron. Web: switch + interval di form (bagian image), tombol "Cek update image" di panel deploy, ikon ⟳ di riwayat.
- **Railpack** (`Application.buildType = 'railpack'`, `railpack-builder.service.ts`): builder ketiga dari Railway. Berbeda dari nixpacks, plan-nya **bukan Dockerfile** melainkan JSON untuk
  BuildKit, jadi tidak bisa lewat `POST /build` klien sendiri → dijalankan penuh di dalam helper: image `aoox-railpack:<RAILPACK_VERSION>` (`docker:29-cli` + git + binary railpack,
  dibangun sekali lewat `POST /build` + `tarSingleFile` seperti helper nixpacks) yang meng-clone repo lalu `railpack build /src --name <imageRef> --cache-key <projectId>/<appName> --progress plain --env K=V`
  (`railpackScript()` pure & di-unit-test) dengan socket daemon host di-mount dan `BUILDKIT_HOST=docker-container://aoox-buildkit`. Log helper di-stream (`followContainerLogs`) ke deployment.
  **Cache bertahan antar deploy** — itu alasan utamanya: BuildKit berjalan sebagai container jangka panjang `aoox-buildkit` (`moby/buildkit:<BUILDKIT_VERSION>`, privileged,
  `restart: unless-stopped`, volume `aoox_buildkit`, label `aoox.component=build` sehingga diabaikan monitoring & notifikasi container-mati), dinyalakan otomatis saat build pertama
  (`ensureBuildkit`). Diuji nyata: build dingin 284 s, build kedua 54 s, redeploy lewat API 8,3 s (semua layer `CACHED`) — deployment penuh 43 s termasuk push & start.
  Image hasil di-load ke daemon lalu mengikuti jalur push/replaceContainer yang sama. **Hanya host** (`serverId` + railpack → error jelas; BuildKit per server di luar cakupan).
  Runtime: image railpack mendengarkan `$PORT` (konvensi Railway, default 80) → runner menambahkan `PORT=<containerPort>` ke env container bila app tidak menyetelnya sendiri.
  Cache BuildKit tidak terlihat `POST /build/prune` daemon, jadi `MaintenanceService.cleanup()` memanggil `railpack.pruneCache(BUILDKIT_CACHE_KEEP_GB × 1 GB, default 10)`
  (`buildctl prune --keep-storage` lewat exec) dan melaporkannya sebagai `buildkitCache` di `CleanupReport` (tampil di kartu Disk). Catatan: batasan "tanpa cache dependensi" di paragraf
  nixpacks hanya berlaku untuk nixpacks/static, bukan railpack.
- **Root directory / monorepo** (`Application.rootDirectory` nullable + `watchRootOnly` bool, migrasi `ApplicationRootDirectory`; `root-directory.ts`): membangun **subfolder** repo untuk
  SEMUA build type git, termasuk preview PR (yang lewat `buildImage` yang sama). Null/kosong = root repo (perilaku lama). **Mekanisme per jalur**: Dockerfile →
  `POST /build?remote=<git>#<branch>:<dir>` (`gitContextRef()`; sintaks git context + subdirektori Engine API — konteks build = `<dir>`, jadi `dockerfilePath` relatif terhadapnya; `:` aman
  karena git melarangnya di nama branch); nixpacks/railpack/static → helper tetap `git clone` ke `/src` lalu membangun dari `$APP` = `/src/<dir>` (`appDirPrologue()`: nixpacks `build "$APP" --out "$APP"`
  dan `tar -C "$APP"`, railpack `build "$APP"`, static menulis `.aoox/` di `$APP`, tar `$APP`, jadi `staticOutputDir` relatif terhadap folder itu tanpa kode khusus). **Keamanan path**:
  `isValidRootDirectory()` (segmen `[A-Za-z0-9._-]` dipisah `/`, tanpa awalan/akhiran `/`, tanpa segmen titik-saja atau `.git`, maks 200) dipakai **dua kali** — validator DTO create & update
  (`IsRootDirectoryConstraint`, plus `@ValidateIf(v !== '')` untuk `""` dari web) dan lagi `assertValidRootDirectory()` tepat sebelum dipakai (`gitContextRef`, `rootDirectoryEnv`). Nilainya **tidak pernah**
  diinterpolasi ke skrip shell: dikirim sebagai env `AOOX_ROOT` ke helper dan prologue shell hanya merujuk `"$AOOX_ROOT"`; prologue juga menolak (exit 3) folder yang tidak ada **dan** symlink yang
  resolve ke luar `/src` (`pwd -P`). Service menyimpan `null`, bukan `""` (`normalizeRootDirectory`). Folder yang tidak ada → deployment `failed` dengan `Root directory "x" was not found in the
  repository`: helper exit 3 → `rootDirectoryError`, dan untuk jalur Dockerfile error `stat <tmp>/<dir>: no such file or directory` dari daemon diterjemahkan ke pesan yang sama; container lama tidak
  tersentuh (build gagal sebelum replace). Baris log `Building …` menyebut `(root directory: apps/web)`. **Batasan**: file di luar folder tidak ada di konteks build (Dockerfile di `apps/web` tidak bisa
  `COPY ../packages/x`). **Webhook** (`watchRootOnly`, default false): `pushTouchesRoot()` (pure, di-unit-test) membaca `commits[].added/modified/removed` (GitHub & GitLab) dan membalas `ignored`
  (`no changes under <dir>`) hanya bila setiap commit terbukti di luar folder; **fail-open** (deploy) bila tanpa root, tanpa/kosong `commits`, satu commit tanpa daftar file (merge commit GitHub), ≥ 20 commit
  (batas payload), `total_commits_count` > yang dimuat (GitLab), `forced`, atau `created`. Event PR/preview tidak difilter. Ekspor/impor project membawa kedua field (opsional di file lama; nilai tidak valid saat
  impor → `null` + warning). Diuji nyata (git daemon lokal, repo `apps/web`+`apps/site`+`services/api`): Dockerfile root `apps/web` dan `dockerfilePath` relatif, statis root `apps/site` (SPA on/off, output
  relatif), root salah (Dockerfile & static) gagal jelas dengan container lama tetap jalan, root kosong = lama, path berbahaya 400 (create & update), symlink keluar ditolak, webhook ignored/queued, preview PR
  membangun dari subfolder. **Belum diuji penuh**: nixpacks dan railpack (TLS intercept AV mencegat unduhan di dalam container) — hanya perakitan skrip/env (unit test); contoh di `dummy-apps/monorepo-sample`.
- Prasyarat deploy dari git: registry lokal sudah di-provision. Belum: buildpacks lain, notifikasi khusus "image diperbarui" (memakai notifikasi deployment biasa).

## Sumber secret eksternal (Infisical)

- `src/modules/secret-source/` — aoox hanya menjadi **klien API** ke Infisical milik user (Cloud atau self-hosted); **bukan** template Infisical (itu ditolak user). Entity `SecretConnection`
  (`secret_connections`: `name` unik, `provider` `infisical`, `url` nullable = `https://app.infisical.com`, `client_id`, `client_secret_encrypted` `select:false`, AES lewat `secret.util` + `ENCRYPTION_KEY`).
  Flow: `POST /secret-connections` (owner/admin; url http(s) tanpa kredensial/query, nama unik 409), `GET` (semua anggota, DTO tanpa secret — untuk dropdown), `DELETE /:id` (owner/admin; FK
  `applications.secret_connection_id` `ON DELETE SET NULL`, SQL migrasi `SecretSource`, tanpa relasi TypeORM supaya modul ini tidak meng-import application), `POST /:id/test` (login Universal Auth saja,
  throttle 20/menit, `{ok, message}`). `SecretSourceModule` di-import `ApplicationModule` dan `ProjectTransferModule`, tidak pernah sebaliknya.
- **Klien** (`infisical.client.ts`, `fetch` + `AbortSignal.timeout(10 s)`, tanpa SDK): `POST /api/v1/auth/universal-auth/login {clientId, clientSecret}` → `accessToken`; lalu
  `GET /api/v4/secrets?projectId&environment&secretPath&recursive=false&includeImports=true&expandSecretReferences=true` (Bearer). Diverifikasi ke dokumentasi resmi (infisical.com/docs/api-reference).
  Bila v4 menjawab **404** dicoba `GET /api/v3/secrets/raw?workspaceId&…&include_imports=true` (instalasi self-hosted lama) — endpoint v3 ini **tidak** terverifikasi dari dokumentasi (halamannya
  tidak ada), hanya dari pengetahuan sebelumnya; 404 di keduanya = galat nyata. Hasil: key → value (import dulu, secret folder sendiri menang; `secretValueHidden` dilewati). Galat = `SecretSourceError`
  dengan pesan pendek dari status HTTP + field `message` Infisical (dipotong 160), timeout `no answer within 10s`, `could not reach the server (ECONNREFUSED)` — **tidak pernah** memuat client secret,
  token, URL berkredensial, atau nilai secret. Token login hanya hidup di dalam satu panggilan `fetchSecrets`; **tidak ada cache lintas panggilan** (tiap resolve = login + list baru).
- **Aplikasi** (kolom `secret_connection_id`, `secret_project_id`, `secret_environment`, `secret_path` default `/`, `secret_sync` default false): `PUT /applications/:id/secret-source
  {connectionId|null, projectId, environment, path, sync}` (developer+: PUT = tulis, viewer 403 lewat `assertAccess`; **409 selama ada deployment aktif** karena runner menyimpan salinan entity dan
  menimpa perubahan, sama dengan host port). `connectionId` `null`/`""` = lepas sumber: field lain diterima tapi diabaikan (web mengirimnya), disimpan `null`/`'/'`/`false`. Validasi
  (`secret-selection.ts`): `projectId` `[A-Za-z0-9_-]{1,100}`, `environment` `[A-Za-z0-9_-]{1,64}`, `path` `/` atau `/seg/seg` (`[A-Za-z0-9._-]`, tanpa `..`, tanpa `/` akhir), `path` kosong → `/`.
  `POST /applications/:id/secret-source/preview` → `{keys: string[]}` **nama saja**, terurut (POST ⇒ viewer 403, throttle 20/menit, memakai konfigurasi tersimpan; galat sumber → 400 dengan pesan pendek).
  `get-application` menambah `secretSource: {connectionId, connectionName, projectId, environment, path, sync} | null`.
- **Resolver** (`EnvResolverService.resolve(app, {secretSource?, lenient?})`): prioritas **env project < secret Infisical (hanya bila `secretSync`) < env aplikasi**; `${{secret.KEY}}` didukung di env
  project dan aplikasi. Secret baru diambil bila `secretSync` atau ada referensi; key yang bukan nama env valid (`[A-Za-z_][A-Za-z0-9_]*`) dilewati; **nilai dari sumber literal** (`${{…}}` di dalamnya
  tidak diperluas). Key tak dikenal → `EnvReferenceError` (400 saat `update-application` memvalidasi env, atau deployment `failed`). Fetch gagal saat container dibuat (deploy, `applyRuntimeConfig`, rollback,
  job `run`) → deployment `failed` dengan pesan ringkas; env di-resolve **sebelum** container lama disentuh, jadi container lama tetap jalan (diuji nyata). Validasi simpan-env memakai `lenient`: sumber tak
  terjangkau bukan galat dan referensi `secret.*` tidak dicek (sumber yang flaky tidak boleh memblokir edit). Semua nilai yang diambil (≥ 6 karakter, supaya log biasa tidak rusak) masuk `secrets`
  → `DeploymentLog.redact`, redaksi `app-error-watcher` (bila sumber tak terbaca saat notifikasi, contoh log **tidak dikirim**) dan keluaran job `run`. Env yang ada di `docker inspect` container
  tentu terlihat oleh siapa pun yang punya akses Docker host — sama dengan password database.
- **Preview PR tidak mewarisi sumber** (`replaceContainer` memanggil resolver dengan `secretSource: !override`): branch PR = kode arbitrer, aturan yang sama dengan mount. Env aplikasi yang memakai
  `${{secret.KEY}}` membuat preview-nya gagal dengan pesan "not available in pull-request previews" (bukan nilai kosong diam-diam). Stack compose tidak punya sumber (referensi `secret.*` = galat jelas).
- Ekspor/impor project: `applications[].secretSource {connection (NAMA), projectId, environment, path, sync}`, **tanpa kredensial**; impor mencocokkan nama, koneksi tak ada atau lokasi tidak valid →
  sumber kosong + warning.
- **Belum diuji nyata terhadap Infisical sungguhan** (user akan menguji): semua diuji lewat server tiruan lokal yang memeriksa path/parameter persis dari dokumentasi (login 401, v4 200, folder 404,
  server mati) dan tes unit dengan `fetch` palsu. Tidak terverifikasi: perilaku `imports` (urutan prioritas antar import), jalur fallback v3, `viewSecretValue`/`secretValueHidden` pada identitas tanpa izin baca nilai,
  organisasi dengan banyak sub-organisasi (`organizationSlug` tidak dikirim), dan TLS self-hosted dengan CA privat (fetch Node memakai trust store default).

## Git credential & Webhook

- `src/modules/git-credential/` — entity `GitCredential` (`github`|`gitlab`|`generic`, `token_encrypted` `select: false`, dienkripsi `src/modules/docker/secret.util.ts`
  dengan `ENCRYPTION_KEY` — util yang sama dipakai registry). Flow `create/list/delete-git-credential` (owner/admin). Hapus → `applications.git_credential_id` SET NULL.
- Repo privat: `Application.gitCredentialId`; runner membangun `https://user:token@host/repo` (`GitCredentialService.authenticateUrl`) hanya sebagai variabel lokal
  untuk `POST /build?remote=` (daemon meneruskan userinfo — diverifikasi; daemon juga tidak menampilkannya di pesan error). `DeploymentLog.redact(token)` menyensor
  token (mentah & URL-encoded) di log dan `errorMessage`. DTO menolak `gitUrl` yang mengandung `@`.
- Webhook: `Application.webhookToken` (32 byte random, `select: false`, unik) → `POST /webhooks/:token` (`webhook-deploy/`, **tanpa JwtAuthGuard**, throttle 30/menit,
  `timingSafeEqual`). Push ke `refs/heads/<gitBranch>` → `DeployApplicationService.queue(app, 'build', {trigger:'webhook', ...})`, commit & pusher dari `parsePushCommit()`
  (`webhook-deploy.service.ts`, pure & di-unit-test: GitHub `after`/`head_commit.message`/`pusher.name`, GitLab `checkout_sha`/commit terakhir di `commits[]`/`user_name`
  — lihat bagian Application & Deploy soal `Deployment.trigger`); branch lain / event non-push / branch dihapus → 200 `ignored`;
  deployment sedang berjalan → 200 `busy` (tidak antre). `get-webhook/` (URL dari `PUBLIC_API_URL`) dan `regenerate-webhook/`. Pengiriman dari provider sungguhan belum diuji (localhost).
  **Jebakan yang ditemukan**: `PUBLIC_API_URL` dibaca oleh **container `api` sendiri** (`ConfigService.get`, di sini dan di `compose-webhook.service.ts` +
  `panel-domain.service.ts` untuk `applied.publicApiUrl`) — bukan cuma dipakai `web` untuk terminal socket seperti terlihat dari namanya. `docker-compose.dist.yml`
  sekarang meneruskan var ini ke **kedua** service (`api` dan `web`); sebelumnya hanya `web` yang mendeklarasikannya, jadi API selalu jatuh ke fallback
  `http://localhost:3001` walau domain API sudah diset lewat panel-domain (yang menulis `PUBLIC_API_URL` ke `.env.dist` tapi tidak ada gunanya kalau service api
  tidak membacanya) — webhook URL di dashboard dan status "Saat ini terpasang" di kartu Domain panel ikut menampilkan `localhost` yang salah. Aturan umum: kalau
  menambah `config.get<...>('X')` baru di kode API, cek juga apakah `X` perlu ditambahkan ke blok `environment:` service **api** (bukan cuma web) di
  `docker-compose.dist.yml` — lihat bagian Docker/distribusi soal menyalin ulang ke `aoox-cli/assets/install/`.
- **Secret webhook** (`Application.webhookSecretEncrypted`, nullable `select:false`, AES via `secret.util` seperti secret lain — token URL tetap plaintext karena jadi kunci lookup; `webhook-secret/`: `PUT /applications/:id/webhook/secret` buat/rotasi, `DELETE` nonaktif; nilainya ikut di `get-webhook`
  agar bisa disalin ke provider). Bila diset, `webhook-deploy` menuntut bukti: GitHub `X-Hub-Signature-256` = `sha256=HMAC-SHA256(secret, raw body)` atau GitLab `X-Gitlab-Token` = secret
  (`webhook-signature.ts` `verifyWebhookSignature`, `timingSafeEqual`) → selain itu **401** (sengaja bukan 200 seperti event tak relevan: docs GitHub menetapkan 401 untuk signature salah, throttle membatasi brute force). Butuh **`rawBody: true`** di `NestFactory.create` + `@Req() RawBodyRequest` (docs NestJS "Raw body"),
  karena HMAC dihitung atas byte persis, bukan JSON hasil parse. Tanpa secret = perilaku lama (token URL saja).
- Verifikasi IP request masuk (GitHub, opsional): lihat bagian "Webhook masuk (keamanan tambahan)" di bawah — HMAC webhook keluar (notifikasi) sudah ada, lihat bagian Notifikasi.

## Preview deployments (pull request)

- Entity `PreviewDeployment` (`preview_deployments`, unik per `application_id`+`pr_number`; branch head PR, sha, host, status building→running|failed, logs).
  Bukan `Deployment`: satu PR = container sendiri `aoox-app-<appName>-pr<N>` + router Traefik `<appName>-pr<N>` + host `<appName>-pr<N>.<previewDomain>`
  (`Application.previewDomain` atau env `PREVIEW_DOMAIN`; butuh DNS wildcard; sertifikat ACME per host saat pertama diakses; server remote = tanpa host).
- **Opt-in** `Application.previewsEnabled` (default false — branch PR adalah kode arbitrer); PR dari **fork selalu diabaikan**; maks `PREVIEW_MAX` (5) preview terbuka per app.
- `preview.service.ts`: `upsert(app, pr)` (buat/segarkan row lalu build detached), `destroy`, `hostFor`; membangun lewat `DeploymentRunnerService.buildTargets` +
  **`buildImage(app, branch, {tag, suffix:'-preview', log})`** (dipisah dari `run()` agar deployment & preview berbagi build/push/redaction/nixpacks/server remote) dan
  `replaceContainer(app, imageRef, log, override)` (nama/router/hosts/label sendiri, tanpa port host). `PreviewLog` = `BuildLog` berbasis row. Setelah build dan setelah start
  dicek row masih ada (PR ditutup saat build → container tidak ditinggal). TypeORM `remove()` mengosongkan `id` entity — simpan id sebelum destroy bila perlu dikembalikan.
- Webhook (`webhook-deploy.service.ts`, `parsePullRequest`): GitHub `X-GitHub-Event: pull_request` (`opened|synchronize|reopened` → upsert, `closed` → destroy; fork = `head.repo.full_name
  ≠ base.repo.full_name`) dan GitLab `merge_request` (`open|update|reopen` / `close|merge`, `source_project_id ≠ target_project_id`). Balasan 200 `result: preview|preview-closed|ignored`.
  Endpoint: `GET /applications/:id/previews`, `DELETE /previews/:id`. Pengiriman dari provider sungguhan belum diuji (disimulasikan dengan curl).

## Proxy & Domain

- `src/modules/proxy/` — `proxy.service.ts` menjalankan **Traefik v3** (`aoox-proxy`, network bridge `aoox`, volume `aoox_proxy_acme`)
  dengan docker provider (`exposedbydefault=false`), entrypoint `web`/`websecure`, dan resolver ACME `le` (HTTP-01) bila `PROXY_ACME_EMAIL` di-set.
  Flow: `proxy-status/`, `provision-proxy/`, `remove-proxy/` (owner). Port host: `PROXY_HTTP_PORT`/`PROXY_HTTPS_PORT` (dev: 8088/8443 karena 80 dipakai).
- Entity `Domain` (`domains`, `host` unik, `https`) di application module; flow `add-domain/`, `list-domains/`, `delete-domain/`. `add-domain/` sekarang meniru
  `PanelDomainService`: sebelum `applyRuntimeConfig` (label Traefik useless tanpa yang listen), cek `ProxyService.statusOn()` pada daemon yang tepat (lokal, atau
  `RemoteDockerService.forServer(app.serverId)` + `proxySettingsOf(server)` untuk app di server remote) dan `provisionOn()` otomatis kalau belum `running` —
  proxy yang sudah jalan tidak disentuh. Respons `AddDomainResult { domain, proxyAutoProvisioned }` (bukan `Domain` polos lagi) supaya web bisa menampilkan
  peringatan yang sama dengan panel-domain (DNS/firewall/tunggu ACME) saat menambah domain pertama untuk sebuah app. Tanpa `PROXY_ACME_EMAIL` di host/server,
  proxy tetap jalan tapi tanpa ACME — domain `https` yang diminta baru benar-benar dapat sertifikat setelah `acmeEmail` diisi (lewat panel-domain untuk host,
  atau pengaturan server untuk server remote).
- Label Traefik dibuat `proxy.labelsFor(appName, port, domains)` (instance; memakai `httpsPort` + ada/tidaknya ACME) → `ProxyService.buildLabels(..., {httpsPort, acme})` (static, di-unit-test)
  dan dipasang di `replaceContainer`; semua container app join network `aoox` (`HostConfig.NetworkMode`).
  Router per app: `<name>` (web, host non-https), `<name>-secure` (websecure + certresolver `le`), dan **`<name>-redirect`** (web, host https → 301 https via middleware
  `redirectscheme`, `port` = `PROXY_HTTPS_PORT`) — redirect hanya dibuat bila ACME aktif, supaya tanpa `PROXY_ACME_EMAIL` (dev) host https tetap bisa diakses http, bukan
  diarahkan ke sertifikat self-signed Traefik. Ubah domain → `DeploymentRunnerService.applyRuntimeConfig(app)` (recreate container dengan `currentImage`, tanpa build);
  container lama baru mendapat label baru setelah redeploy/ubah domain.
- Domain untuk panel sendiri, dua jalur: (1) **manual** — override `docker-compose.domain.yml` (`-f docker-compose.dist.yml -f docker-compose.domain.yml`) memasang label yang sama ke
  service `web`/`api` (`WEB_DOMAIN`/`API_DOMAIN` wajib, butuh `PROXY_ACME_EMAIL`; `WEB_ORIGIN`/`PUBLIC_API_URL` harus diganti ke https); (2) **dari dashboard** —
  `src/modules/panel-domain/` (`GET`/`PATCH /instance/domain`, owner saja): `PanelDomainSettings` (row tunggal `panel_domain_settings`) menyimpan `webHost`/`apiHost`/`acmeEmail`;
  `PATCH` men-throttle 5/menit, butuh env `INSTALL_DIR` (path absolut folder `docker-compose.dist.yml` di host — belum ada default, harus diisi manual di `.env.dist`) lalu
  `apply()` di-jadwalkan `setTimeout` 1,5 detik (agar response HTTP sempat terkirim sebelum container ini sendiri di-recreate): sebelum apa pun, kalau `ProxyService.status()`
  bilang proxy belum `running`, **provision otomatis** (`ProxyService.provisionOn` dengan `acmeEmail` dari setting yang baru disimpan) — tanpa ini label Traefik terpasang tapi
  tidak ada yang listen di port 80/443, domain jadi "unable to connect" tanpa error yang jelas (ditemukan lewat test VPS sungguhan). Proxy yang **sudah** `running` tidak disentuh
  (tidak di-recreate ulang tiap kali domain disimpan, supaya ACME state & routing app lain tidak terganggu). Lalu helper `docker:29-cli` (pola sama dengan
  `compose-runner`) mem-bind `INSTALL_DIR` host langsung (bukan volume) ke path yang sama di helper, `putArchive` menulis `docker-compose.override.yml` (nama **berbeda** dari
  `docker-compose.domain.yml` manual). **Jebakan yang ditemukan**: Compose hanya otomatis meng-include `docker-compose.override.yml` kalau file utamanya bernama persis
  `docker-compose.yml` (default lookup tanpa `-f`) — begitu `-f docker-compose.dist.yml` disebut eksplisit (seperti di sini), override **tidak** ikut ter-load kecuali disebut
  eksplisit juga; salah asumsi ini bikin label Traefik ditulis ke disk tapi tidak pernah benar-benar dipasang ke container. Karena itu skrip selalu `-f docker-compose.dist.yml -f
  docker-compose.override.yml` (jalur ini menulis file itu sendiri lebih dulu, jadi selalu ada) — `instance-update` (di bawah) mengecek dulu file itu ada sebelum menyebutnya, karena
  di sana filenya mungkin belum pernah ditulis sama sekali. Lalu skrip `sed`/`grep` meng-upsert `WEB_DOMAIN`/`API_DOMAIN`/`PROXY_ACME_EMAIL`/`WEB_ORIGIN`/`PUBLIC_API_URL`/`COOKIE_SECURE`
  di `.env.dist` sebelum `docker compose up -d`.
  Label Traefik dari `renderPanelOverride()` (`panel-domain.util.ts`, pure & di-unit-test) memakai ulang `ProxyService.buildLabels` langsung untuk router `aoox-web`/`aoox-api`
  (port 3000/3001) — bukan template YAML terpisah seperti jalur manual. `docker-compose.dist.yml` mendeklarasikan network `aoox` (`name:` eksplisit) dan memasukkan `web`/`api`
  ke sana selain `default`, sehingga Traefik bisa menjangkaunya. Port 3000/3001 tetap dipublikasikan untuk akses via IP di kedua jalur. `aoox-cli`: `aoox domain set --web --api
  [--acme-email]` memanggil endpoint yang sama (butuh `aoox login` dulu). Belum: validasi DNS sebelum apply (beda dari domain aplikasi yang punya `check-domain-dns`), rollback
  otomatis kalau `docker compose up` gagal setelah domain diganti (container lama sudah kadung diganti argumennya, bukan blue/green seperti app).
- **Cek DNS** (`check-domain-dns/`, `GET /applications/:id/domains/:domainId/dns`, throttle 30/menit, tidak disimpan): `dns.promises` resolve4/6 (+CNAME untuk tampilan)
  dibandingkan dengan IP yang diharapkan: app di server remote → `Server.host` (literal IP atau di-resolve), selain itu `PUBLIC_IP` env, atau auto-deteksi via `https://api.ipify.org`
  (cache 10 menit; gagal → status `unknown`, bukan error). Status `ok|mismatch|unresolved|unknown` (`evaluate()` pure, di-unit-test) + `message`. Tidak memblokir `add-domain` —
  DNS boleh diatur belakangan.
  **Cek berkala** (`dns-watcher.service.ts`, application module — bukan notification module, karena butuh `Domain` repo + `CheckDomainDnsService`, dan `ApplicationModule`
  sudah meng-import `NotificationModule`, arah sebaliknya jadi siklus): tiap 15 menit menjalankan ulang `execute()` yang sama untuk **setiap** domain terdaftar (https maupun
  tidak — DNS salah merusak routing apa pun, bukan cuma ACME) dan mengirim notifikasi `dnsIssue` (toggle `on_dns_issue`, default aktif) kalau `mismatch`/`unresolved` bertahan
  **dua** pemeriksaan berturut-turut (`badSince` Map, pola sama dengan `service-health-watcher.service.ts`; meredam wobble DNS transien dari host ini), lalu maks 1×/hari/domain
  selama tetap rusak (`notified` Map, cooldown sama dengan `certificate-watcher`). `unknown` (tanpa IP pembanding) tidak pernah mengirim. Domain yang sehat lagi atau sudah
  dihapus mereset/membuang entrinya (dibersihkan tiap tick lewat daftar domain yang masih ada, supaya tidak bocor memori). Diuji nyata: `one.one.one.one` (resolve publik ke
  1.1.1.1, sengaja bukan IP host ini) → dua tick manual mengirim webhook `dns.issue` persis sekali dengan `status:"mismatch"`; tick pertama tidak mengirim apa pun. Menangkap
  penyebabnya lebih awal daripada `certificate-watcher` (yang baru tahu setelah Traefik gagal ACME), dan berlaku juga untuk domain http-only yang tidak pernah menyentuh ACME.

## Notifikasi

- `src/modules/notification/` — entity `Notification` (`notifications`: `type` `telegram`|`slack`|`discord`|`webhook`|`email`, `config_encrypted` JSON AES via `ENCRYPTION_KEY`,
  `select:false`; toggle `on_deployment_success`/`on_deployment_failure`/`on_backup_failure`/`on_container_down`). Platform-wide, `@Roles('owner','admin')`.
  Flow: `create/list/delete-notification`, `test-notification` (`POST /notifications/:id/test` mengirim pesan contoh). DTO tidak pernah memuat token/URL/password SMTP — hanya `targetHint`.
- `notification-sender.ts` — `requestFor(config, message)` (pure, di-unit-test) → payload per platform (Telegram `sendMessage` HTML, Slack attachments, Discord embeds, webhook JSON datar);
  `sendNotification` pakai `fetch` global + `AbortSignal.timeout(10s)`. Email lewat **nodemailer** (`sendEmail`, SMTP per channel: host/port/secure/user/password/from/to — bukan env),
  `emailContent()` = subject/text/html. Webhook generik = SSRF by design; owner/admin sudah punya shell host, jadi bukan eskalasi.
  `broadcast(event, message)` memfilter channel lewat `EVENT_TOGGLE` (event → kolom toggle).
- Event lain: **backup gagal** — `DatabaseBackupService.backup()` memanggil `broadcast('backupFailure')` (manual & terjadwal) fire-and-forget; **job gagal/timeout** — `jobFailure` (`on_job_failure`).
  **Container mati** — `docker-events.service.ts` (docker module) menjaga satu stream `GET /events` (`type=container`, `event=die`, `label=aoox.component` —
  hanya **key**: beberapa nilai `label` di satu filter Docker di-AND, bukan OR) dengan reconnect backoff + `OnApplicationShutdown`;
  `container-down-notifier.service.ts` (application module) menunggu `GRACE_MS` 5 detik lalu memutuskan: container sudah tidak ada (di-replace deploy / dihapus), row app/db `stopped`
  (stop flow menulis status *setelah* stop → karena itu grace), atau running lagi dengan exit code 0 (restart bersih) = diabaikan; selain itu kirim, maks 1×/container/10 menit (`COOLDOWN_MS`).
- **Watcher** (`src/modules/notification/watchers/`, cron di `NotificationModule` yang kini meng-import `ScheduleModule`+`DockerModule`): `disk-watcher.service.ts` — 07:00 harian,
  busybox `df -Pk` dengan `/var/lib/docker` di-bind `:ro` (`docker system df` tidak tahu sisa ruang; di Docker Desktop yang diukur = disk VM) → `parseDf()` (pure) → di atas
  `DISK_ALERT_PERCENT` (default 90) kirim `diskLow` maks 1×/24 jam. `certificate-watcher.service.ts` — tiap 10 menit membaca 400 baris log `aoox-proxy`, `parseAcmeFailures()`
  (pure; format console & JSON Traefik, ANSI dibersihkan) → `certificateFailure` per domain maks 1×/24 jam. Toggle kolom `on_disk_low`, `on_certificate_failure`.
  **DNS domain** — `dnsIssue`/`on_dns_issue`: lihat `dns-watcher.service.ts` di bagian Proxy & Domain → Cek DNS (bukan di sini, karena butuh `Domain` repo).
- **Webhook keluar bertanda tangan**: config webhook punya `secret` opsional; `webhookHeaders()` (pure, di-unit-test) menambahkan `X-Aoox-Event`, `X-Aoox-Delivery`
  (= `body.id`, UUID per kiriman) dan `X-Aoox-Signature: sha256=HMAC-SHA256(secret, raw body)` — dihitung atas byte persis yang dikirim (`raw` di `sendNotification`), skema GitHub.
  Body webhook kini selalu memuat `id` dan `timestamp`.
- Pengirimannya di application module: `deployment-notifier.service.ts` subscribe `DeploymentEventsService.onStatus` (emit **sinkron** dari dalam runner → listener hanya menjadwalkan,
  tidak pernah throw), hanya `success`/`failed`, lalu **membaca ulang row Deployment** (error sudah di-redact oleh `DeploymentLog`) dan `NotificationService.broadcast(event, message)`;
  kegagalan per channel hanya di-log. Link ke `${WEB_ORIGIN}/applications/<id>` bila `WEB_ORIGIN` di-set. `ApplicationModule` meng-import `NotificationModule` (bukan sebaliknya).
- **Deploy dimulai** (`on_deployment_started`, **default `false`** — beda dari toggle lain yang default `true`, karena event ini bisa sering terjadi lewat webhook/
  auto-update dan channel yang sudah ada belum tentu mau tahu setiap kali): `deployment-notifier.service.ts` juga subscribe `DeploymentEventsService.onCreated`
  (`emitCreated`, ditambahkan `DeploymentRunnerService.start()` — titik cekik tunggal yang dipanggil **setiap** jalur pembuatan deployment: build/webhook/
  auto-update/rollback/config, jadi `deployment:created` selalu tepat sekali per deployment apa pun pemicunya). Handler membaca ulang row lalu **melewati**
  `kind: 'config'` (deployment tanpa build — cuma re-apply mode/replika/limit swarm pada image yang sama; bukan "deploy baru" yang layak ditunggu, dan bisa
  sering terjadi untuk penyesuaian rutin — mengirim untuk ini akan lebih berisik daripada berguna). Pesan: nama app, project, dan field **Trigger** dari
  `trigger-summary.ts` `triggerSummary()` (helper murni yang sudah dipakai baris pertama log deployment — commit pendek + pesan commit + pengirim untuk webhook,
  "Triggered by auto-update" untuk auto-update, "Triggered manually" selainnya), `level: 'info'`.
- **Error aplikasi dari log** (`on_app_error`, **default `false`** untuk semua channel — deteksi dari teks log rawan salah tebak, jadi opt-in murni, beda dari toggle
  lama yang defaultnya `true`): `app-error-watcher.service.ts` (application module, `@Cron` tiap menit, pola sama dengan `dns-watcher.service.ts`) memindai log tiap
  aplikasi `running` dengan `Application.ignoreErrorLogs = false` (switch per app, default `false`, untuk app yang normal outputnya memang berisik seperti error).
  **Bukan** stream `follow` permanen per container — `DockerEngineClient.containerLogsSince(id, sinceUnixSeconds)` (`GET /containers/{id}/logs?since=`) dipanggil
  tiap tick dengan kursor in-memory per container id (bukan per app, karena mode `service` punya banyak task container); container yang baru pertama terlihat
  cuma di-baseline (kursor = sekarang) tanpa memindai log lama, supaya app yang baru deploy/restart tidak langsung memicu notifikasi dari log historisnya sendiri.
  App di server remote → `RemoteDockerService.forServer(app.serverId)`; mode `service` → `SwarmDeployService.taskContainers(app)` (selalu daemon lokal, swarm
  memang host-only). **Stack compose dan preview PR di luar cakupan** (lihat bagian masing-masing).
  Detektor murni `log-error-detector.ts` `detectLogErrors()` (di-unit-test luas): pola awal event `Traceback (most recent call last)`, `^panic:`,
  `Unhandled(Promise)?Rejection`, `\w*(Error|Exception)\b[:\s]` (butuh huruf besar "Error"/"Exception" persis, jadi "retrying after error: x" berhuruf kecil
  tidak kepicu), `level[=:]"?(error|fatal)"?`, `\bFATAL\b`, `\[ERROR\]`, atau baris JSON dengan field `level`/`severity` bernilai `error`/`fatal` (string) atau
  `50`/`60` (angka, level pino) — dicek lebih dulu terhadap daftar **false positive** eksplisit (`0 errors`, `errors: 0`, `no error`, `error_count=0`, case-insensitive)
  supaya tidak kepicu. Baris lanjutan (indentasi, `at …`, `File "…`) digabung ke event yang sama, dibatasi 20 baris total; baris pertama yang tidak diindentasi
  mengakhiri penggabungan (kadang bikin baris ringkasan exception Python — yang memang tidak diindentasi — terdeteksi sebagai event terpisah dari Traceback-nya;
  disengaja, tetap lebih baik daripada tidak terdeteksi sama sekali). Fingerprint = baris pertama yang dinormalisasi (`normalizeFingerprint()`: UUID/hex/timestamp/
  durasi/angka polos → placeholder) supaya kejadian error yang sama bentuknya (beda id request) tidak dianggap error baru terus-menerus.
  Kirim **satu notifikasi per app per tick** (bukan per baris): jumlah error, maksimal 3 contoh (fingerprint berbeda, dipotong 300 karakter), link
  `${WEB_ORIGIN}/applications/<id>`, `level: 'failure'` (tidak ada level `'warning'` di `NotificationMessage`). **Cooldown** 15 menit per app — **kecuali** ada
  fingerprint yang belum pernah terlihat sejak boot untuk app itu (`seenFingerprints` in-memory per app id), yang selalu tetap dikirim biar error baru tidak
  ketahan cooldown punya error lama. Peta in-memory (`cursorSeconds` per container, `seenFingerprints`/`lastNotified` per app) dibersihkan tiap tick untuk
  container/app yang sudah tidak aktif — app yang hilang lalu muncul lagi dianggap baru (di-baseline ulang, bukan melanjutkan cooldown lama).
  **Redaksi**: nilai env mentah yang key-nya mengandung `PASSWORD`/`SECRET`/`TOKEN`/`KEY`, plus password database ter-resolve dari `EnvResolverService.resolve()`
  (set yang sama yang didaftarkan `DeploymentLog.redact` saat deploy) — keduanya diganti `***` di teks contoh sebelum dikirim; referensi `${{...}}` yang rusak
  hanya membuat redaksi database itu dilewati (tidak menggagalkan notifikasi). `EVENT_TOGGLE`/`CreateNotificationDto`/`notification.entity.ts` menambah
  `onAppError` mengikuti pola `onDeploymentStarted`.
- **Toggle baru harus ada di SEMUA titik** (pelajaran `onDnsIssue`/`onServerDown`/`onHttpDown`): kolom entity `on_*`, `NotificationEvent` + `EVENT_TOGGLE` (diekspor), `NotificationDto`/`toDto()`,
  `CreateNotificationDto`, `CreateNotificationService.execute()` (`repo.create`), entity web, skema zod + `formData` di `notification.actions.ts`, `EVENT_LABEL` di `notifications-card.tsx`, docs.
  `notification-toggles.spec.ts` membaca kolom `on_*` dari metadata TypeORM dan memastikan tiap toggle ada di DTO validasi, `EVENT_TOGGLE`, dan benar-benar disimpan/dikembalikan `create` — toggle yang
  hanya ditambah di entity gagal di sana. `serverDown` (`on_server_down`) dan `httpDown` (`on_http_down`) default **`true`**: keduanya opt-in per server/aplikasi, jadi tidak berisik untuk yang tidak memakainya.

## Compose (stack docker-compose)

- `src/modules/compose/` — entity `ComposeApp` (`compose_apps`, di bawah `Project`; `slug` unik, `git_url`/`git_branch`/`git_credential_id`, `compose_path`, `env`,
  `status` idle→deploying→running|stopped|error, `logs` = output aksi terakhir, `deployed_at`). Tidak memakai `Application`/`Deployment`: satu stack = N container,
  jadi `containerNameFor`, port, domain, rollback, riwayat deployment tidak berlaku. Flow `create/list/get/update/delete-compose-app`, `deploy/stop/start-compose-app` (202 + poll `GET /compose-apps/:id`
  yang juga memuat container stack via label `com.docker.compose.project`).
- Compose **tidak ada di Engine API** (alat sisi klien). `compose-runner.service.ts` menjalankan `docker compose` di container helper sekali-jalan `docker:29-cli`
  (docker CLI + plugin compose + git) dengan **socket daemon host** (`DockerService.hostDockerSocket` = `PROXY_DOCKER_SOCKET`, dipakai juga Traefik) dan volume checkout
  `aoox_compose_<slug>`. Volume itu di-mount **di path mountpoint-nya sendiri** (`inspectVolume().Mountpoint`, `/var/lib/docker/volumes/<nama>/_data`) supaya path relatif
  yang di-resolve compose di dalam helper (bind mount `./nginx.conf`, build context) juga ada di sisi daemon — dengan mount `/work` biasa, bind mount gagal (`not a directory`).
  Tanpa `--project-directory`: path relatif dihitung dari folder file compose. `build:` didukung penuh (CLI memakai BuildKit — kebalikan dari batasan nixpacks).
- Deploy: `git clone --depth 1` (kredensial hanya di helper; token & password DB di-redact dari log), `.aoox.env` (hasil `EnvResolverService`, referensi project/database sama seperti app)
  diunggah lewat `PUT /containers/{id}/archive` sebelum start dan dipakai `--env-file` → sumber interpolasi `${VAR}` (tidak otomatis masuk ke container). Lalu `config --quiet` + `up -d --build --remove-orphans`.
  Nama project compose `aoox-<slug>` (grup Docker Desktop sendiri, **bukan** `aoox` — label `com.docker.compose.project` diset CLI dan tidak bisa dua-duanya).
  Output helper di-stream (`followContainerLogs`) ke kolom `logs` tiap ~1 detik. Gagal deploy → notifikasi `deploymentFailure`. `delete` = `down --volumes --remove-orphans` + hapus volume checkout, sinkron.
- **Sumber** `ComposeApp.source`: `git` (clone repo) atau `template` (`compose_content` di DB, `git_url` null, `compose_path` selalu `docker-compose.yml` karena `tarFiles` datar);
  runner mengunggah file compose ke WORK lalu `mv` ke SRC yang baru dibuat — tanpa git. `composeContent` bisa diedit lewat `PATCH` (hanya untuk `template`).
- **Domain stack** (`service_domains` jsonb: `{service, port, host, https}`): saat deploy runner menulis override **`docker-compose.aoox.yml`** (JSON = YAML valid; `renderOverride`,
  pure & di-unit-test) di sebelah file compose, berisi label Traefik dari `ProxyService.labelsFor` (router `<slug>-<service>-<port>`) + network `aoox` **dan `default`**
  (mendeklarasikan `networks:` di service menghapus network default implisit — tanpa `default` layanan stack tidak saling menemukan), lalu `-f compose -f override`.
  Stop/start/down memakai override yang ada di volume (`[ -f ... ] && OVERRIDE=`), bukan dari row, agar cocok dengan stack yang berjalan. Tanpa domain/port = tanpa override
  (override lama ikut hilang karena deploy selalu `rm -rf SRC` dulu, jadi stop/start tidak memakai konfigurasi yang sudah dicabut — diuji: port lepas).
- **Port host** (`service_ports` jsonb `{service, port, hostPort}`, `ServicePortDto`): akses lewat IP tanpa domain/proxy. `renderOverride(domains, ports, …)` menambahkan
  `ports: ["<hostPort>:<port>"]` ke service (tanpa `networks` bila hanya port); compose **meng-append** `ports` override ke `ports` file compose (diuji `config`), jadi binding
  yang sudah ada di file tetap. `ComposeService.assertHostPortsFree()` (dipakai `update-compose-app` & `create-from-template`) menolak 400 sebelum deploy: duplikat dalam daftar, lalu delegasi ke
  `HostPortService` (`src/modules/host-port/`, lihat bagian Application & Deploy) untuk `applications.host_port`, `managed_databases.host_port`, `service_ports` stack lain, dan port yang sedang
  di-bind container **mana pun** di daemon lokal (`listContainers({status:['running']})`, `ContainerSummary.Ports[].PublicPort`; container project compose stack sendiri dikecualikan karena
  di-recreate; entri IPv4/IPv6 di-dedupe) — tanpa ini `up` gagal *setelah* container lama di-recreate, service jadi mati. Cek saat simpan, bukan saat deploy — port yang direbut proses lain di
  antaranya tetap gagal di `up`. `create-from-template` menerima `servicePorts`
  (divalidasi terhadap `template.services` seperti domain). Ekspor/impor project membawa `servicePorts` (opsional di file lama; `freeHostPort` kini juga memindai
  `service_ports` stack lain; port yang sudah dipakai dilewati + warning).
- **Riwayat** (`compose-deployment.entity.ts`, tabel `compose_deployments`: FK cascade ke stack, `action` deploy|stop|start|down, `trigger` manual|webhook, `status` running→success|failed,
  `logs`, `error_message`, `commit_sha`, `started_at`/`finished_at`): tiap jalannya helper = satu row. Tidak ada image/rollback seperti `Deployment` aplikasi — satu stack = N container,
  jadi yang disimpan adalah riwayat **aksi**. Runner: `queue(app, action, options)` membuat row lebih dulu (caller dapat id untuk di-poll) lalu `start()`; log live ditulis **hanya** ke row
  (`ComposeApp.logs` diisi sekali saat selesai, supaya build yang cerewet tidak menggandakan write), dan `get-compose-app` mengembalikan log row yang masih `running` + `deploymentId`.
  Setelah tiap run `prune` menyisakan `COMPOSE_RUN_KEEP` (20) row terbaru. Flow `list-compose-deployments` (`GET /compose-apps/:id/deployments`, tanpa logs) dan `get-compose-deployment`
  (`GET /compose-deployments/:id`, dengan logs; akses lewat project stack-nya).
- **Webhook** (`ComposeApp.webhookToken` unik `select:false` + `webhookSecretEncrypted`, migrasi `ComposeHistoryAndWebhook` mem-backfill token untuk stack lama): publik
  `POST /webhooks/compose/:token` (`webhook-deploy-compose/`, tanpa JwtAuthGuard, throttle 30/menit, `timingSafeEqual`) — kontrak yang sama dengan aplikasi dan memakai ulang
  `webhook-signature.ts` (GitHub `X-Hub-Signature-256` / GitLab `X-Gitlab-Token` → salah = **401**). Push ke `refs/heads/<gitBranch>` → `runner.queue(..., {trigger:'webhook', commitSha})`;
  branch lain / event non-push / **stack template** (compose file ada di DB, tidak ada repo) → 200 `ignored`; run sedang jalan → 200 `busy` (tidak diantre). Flow `compose-webhook/`
  (`GET /compose-apps/:id/webhook`, `POST …/webhook/regenerate`, `PUT/DELETE …/webhook/secret`) membalas `{url, token, branch, secret, supported}`.
- **Metrik & container mati**: container stack tetap tanpa label `aoox.component` (label itu milik compose CLI), jadi keduanya mengenali stack dari **nama project compose**
  `aoox-<slug>` (`COMPOSE_PROJECT_PREFIX`; stack dist sendiri bernama `aoox` tanpa tanda hubung, jadi tidak ikut). `MonitoringService.sampleAll` melakukan **dua** listContainers
  (beberapa nilai `label` di satu filter di-AND) dan menambahkan container compose yang belum punya `aoox.component`; `GET /compose-apps/:id/metrics` (`compose-metrics/`) membaca cache
  sampler per service + total. `DockerEventsService` kini menjaga **dua** stream `GET /events` (satu per label) dengan backoff masing-masing; event dari stream compose yang containernya
  juga ber-`aoox.component` dibuang (container kita punya kedua label lewat `composeLabels()`). `compose-down-notifier.service.ts` (di compose module — ComposeModule sudah meng-import
  ApplicationModule, arah sebaliknya siklus) mengirim `containerDown` "Stack service went down: <stack> (<service>)"; **diam** selama `runner.isActive(app.id)` (deploy me-recreate semua
  container dan `up -d --build` bisa bermenit-menit, grace 5 detik tidak cukup), saat row bukan `running`, container sudah hilang, atau restart bersih (exit 0). Cooldown 10 menit/container.
  Diuji nyata (stack 2 service dari git daemon lokal): deploy manual + lewat webhook bertanda tangan (signature salah 401, branch lain ignored, push kedua busy), **nol** notifikasi selama
  deploy, `docker kill` satu service → **tepat satu** notifikasi, kill container aplikasi tetap satu notifikasi (bukan dobel dari stream kedua).
- Batasan: domain/Traefik = label `traefik.*` di file compose sendiri + join network eksternal `aoox`. File compose dari repo bisa minta `privileged`/host mount — owner/admin sudah punya
  shell host, jadi bukan eskalasi.
- **Retensi metrik untuk stack** (`renderOverride` di `compose-runner.service.ts`): setiap service yang override-nya sudah menyentuh service itu untuk alasan lain (domain, port, mount,
  atau resource limit) juga distempel `aoox.component: compose` + `aoox.compose: <id stack>` — cukup untuk `MetricRetentionService.ownersByContainer()` (yang murni baca label
  container, tanpa query DB) mengenali dan menjumlahkan container itu ke satu baris rollup per stack, **tanpa** perlu MonitoringModule meng-import ComposeModule (jalan pintas ini
  menghindari siklus MonitoringModule → ComposeModule → ApplicationModule → MonitoringModule yang sebelumnya jadi alasan fitur ini "belum ada"). **Batasan yang disengaja**:
  `renderOverride` cuma pernah tahu nama service dari empat daftar yang datang dari DB (`serviceDomains`/`servicePorts`/mounts/`serviceResources`) — tidak pernah dari file compose
  itu sendiri (yang baru ada di dalam helper container saat deploy, bukan di sisi API) — jadi service yang benar-benar tanpa satu pun dari keempatnya (mis. service database internal
  polos tanpa mount) tidak pernah dapat label, dan tetap live-only (1h) seperti sebelumnya; stack yang seluruh service-nya "telanjang" begitu juga. `GET /compose-apps/:id/metrics?range=`
  (`compose-metrics.controller.ts`, DTO lokal `ComposeMetricsQueryDto` — bukan meng-impor punya aplikasi, supaya tidak menambah ketergantungan lintas modul) kini punya kontrak yang sama
  dengan aplikasi/database: `1h` tetap live per-service (`services[]` + `total`) plus `history` gabungan lewat `aggregateMetrics()` yang sama dipakai swarm task; `24h`/`7d`/`30d` membaca
  `MetricRetentionService.history('compose', ...)` — `services[]` kosong (tidak ada riwayat per-service tersimpan, hanya total stack) tapi `history`/`total` terisi.
  Nama `service` di mount dan `serviceResources` (juga `serviceDomains`/`servicePorts` yang sudah ada) **tidak divalidasi** terhadap service yang benar-benar ada di file compose
  (beda dengan `create-from-template` yang mengecek ke `template.services`) — salah ketik nama service menghasilkan override yang menyasar service yang tidak ada; `docker compose config`
  menerimanya tanpa keluhan dan mount/limit itu diam-diam tidak pernah berlaku, bukan error.

## Monitoring

- `src/modules/monitoring/` — `monitoring.service.ts` men-sampel semua container berlabel `aoox.component` yang running tiap 15 detik (`SAMPLE_INTERVAL_MS`)
  dan menyimpan riwayat in-memory 240 titik/container (~1 jam; hilang saat restart, satu instance). Tiap sampel = **dua** `GET /containers/{id}/stats?stream=false`
  berjarak 1 detik, karena dalam mode itu daemon mengisi `precpu_stats` dengan snapshot yang sama (CPU % selalu 0 dari satu panggilan). Rumus di `container-metrics.ts`
  (`computeMetrics`, pure & di-unit-test): CPU % = Δtotal/Δsystem × online_cpus × 100; memori = `usage − inactive_file` (cgroup v2) / `− cache` (v1), seperti `docker stats`;
  `memoryLimitBytes` = RAM host bila container tanpa limit. Disk I/O per container tidak tersedia di Docker Desktop (`io_service_bytes_recursive` kosong) → tidak ditampilkan.
- Endpoint: `GET /applications/:id/metrics` (`application-metrics/`) & `GET /databases/:id/metrics` (`database-metrics/`) hanya membaca cache sampler (`{current, history}`,
  `current: null` bila belum ada sampel/stop); `GET /monitoring/host` (`host-overview/`, owner/admin) = `GET /info` + `GET /system/df` — disk yang terlihat hanya
  pemakaian Docker (image/volume/container/build cache), bukan filesystem host.
- **Retensi metrik** (`metric-sample.entity.ts` `metric_samples`: `owner_kind` application|database + `owner_id` + `resolution` minute|hour + `at`, unik; cpu/mem/limit/net + `containers`):
  `metric-retention.service.ts` — `@Cron('* * * * *')` mengambil titik 15 detik yang **belum ditulis** per container (kursor `written`), mengelompokkannya per pemilik lewat label
  `aoox.application`/`.database` (task swarm satu app dijumlahkan), lalu `averageBucket()` (pure, di-unit-test: rata-rata terhadap **waktu**, tetap jumlah antar container —
  dibagi jumlah titik *per container*) → satu row `minute` (upsert, jadi tick ganda tidak menggandakan). `@Cron('2 * * * *')` merata-ratakan jam yang baru lewat menjadi row `hour`
  (AVG cpu/mem, MAX limit/net/containers). `@Cron('7 3 * * *')` memangkas: menit > 48 jam, jam > `METRICS_RETENTION_DAYS` (default 30).
  Endpoint metrik menerima `?range=1h|24h|7d|30d` (`MetricsQueryDto`, dipakai app & database): `1h` = sampler in-memory seperti dulu (15 s), `24h` = row menit, `7d`/`30d` = row jam;
  respons membawa `range`. Hapus aplikasi → `retention.forget('application', id)` (tabel ini tanpa FK supaya riwayat tidak ikut hilang saat container/row lain dibersihkan).
  Riwayat kini bertahan restart API. Diuji: row menit muncul tiap menit untuk app & 3 DB, `?range=24h` mengembalikan row menit, rollup jam/prune lewat application context
  (10/20/30 → 20). Metrik stack compose kini ikut retensi juga (lihat bagian Compose → "Retensi metrik untuk stack") untuk service yang punya domain/port/mount/resource limit.
  Belum: retensi metrik host (live 5 menit saja).
- **Host live** (`host-metrics.service.ts` + `host-live/` → `GET /monitoring/host/live`, owner/admin, throttle 120/menit): sampler in-process tiap **2 detik** dari Node `os`
  (`os.cpus()` delta idle/total = CPU % semua core, `os.totalmem()-freemem()` = RAM, `loadavg()[0]`; di container Docker `/proc/stat` & `/proc/meminfo` adalah milik host,
  jadi angkanya = host, tanpa panggilan Docker per tick), riwayat 150 titik (5 menit) in-memory. `host-metrics.ts` pure & di-unit-test. Respons juga membawa `managed`
  (`MonitoringService.managedTotals()` — jumlah CPU%/RAM container aoox dari sampler 15 detik) dan `cpus`. **Storage** = `fs.statfsSync(STORAGE_PATH ?? '/')`
  (`readDisk`; di container `/` = overlayfs yang melaporkan disk host di balik `/var/lib/docker`; Windows dev = drive cwd; gagal → 0). Dipoll web tiap 2 detik; tanpa Socket.IO.
- **Limit sumber daya**: `Application` & `ManagedDatabase` punya `cpu_millicores` dan `memory_mb` (nullable = tanpa batas). `docker/resource-limits.ts` `resourceLimits()` (pure, di-unit-test)
  → `HostConfig.NanoCpus` + `Memory` + `MemorySwap` (= `Memory`, jadi limit keras tanpa swap), dipakai saat create container (runner `replaceContainer`, `provision` DB) dan
  `DockerEngineClient.updateContainer` (`POST /containers/{id}/update`) untuk menerapkan **langsung tanpa restart** dari `update-application` / `PATCH /databases/:id` (`update-database/`).
  Catatan Docker: update dengan nilai 0 = "tidak diubah", jadi **mencabut** limit (`limitsRemoved()`) memaksa recreate — app via `applyRuntimeConfig`, DB via `provision` ulang
  (restart singkat; data di volume). Metrik `memoryLimitBytes` otomatis mengikuti limit. Preview mewarisi limit app-nya lewat `replaceContainer` (bukan celah — sudah beres).
  **Limit compose**: `ComposeApp.serviceResources` (jsonb `[{service, cpuMillicores, memoryMb}]` — per service, bukan satu angka untuk seluruh stack, sama seperti
  `serviceDomains`/`servicePorts`) dirender ke override sebagai `deploy.resources.limits.{cpus,memory}` (`cpus` string desimal core, `memory` string `<N>M`). **Dihormati
  `docker compose up` biasa tanpa swarm** sejak Compose v2 — diverifikasi langsung terhadap image runner sendiri (`docker:29-cli`): container dengan `deploy.resources.limits.memory: 64M`
  muncul di `docker inspect` sebagai `HostConfig.Memory` 67108864, bukan 0. Tidak ada jalur update langsung seperti `POST /containers/{id}/update` milik app/db — compose selalu
  redeploy dari override, jadi ubah limit = berlaku di deploy berikutnya.
- **Resource usage per project** (`src/modules/project/project-resource-usage/`, di dalam `ProjectModule` — modul ini meng-import `DockerModule`+`MonitoringModule` langsung,
  bukan sebaliknya, jadi tanpa siklus): `GET /projects/:id/resource-usage` (halaman detail, live saja) dan field baru `resourceUsage` di tiap item `GET /projects`
  (kartu overview, `ProjectResourceUsageSummary | null`) — keduanya CPU%/memori/jaringan saja, **tanpa storage** (sengaja dilewati: `docker system df -v` per volume
  terlalu berat untuk dipanggil live per kartu/per project, beda dengan `MaintenanceService.usage()` yang sinkron dan dipanggil sekali per halaman Settings, bukan di-poll).
  Sumber data = cache in-memory `MonitoringService` yang sudah ada (sampler 15 detik) — **tidak ada panggilan Docker baru per request**. `ProjectResourceUsageService.containerProjectMap()`
  mengelompokkan container yang sudah disampel per project: container application/database langsung membawa label `aoox.project` (diset `deployment-runner.service.ts`/
  `managed-database.service.ts` saat create), jadi tanpa query DB; stack compose **tidak** punya label project (`compose-runner.service.ts`'s override hanya menaruh
  `aoox.component`/`aoox.compose`) — juga "bare" stack tanpa override sama sekali (tanpa domain/port/mount/limit, dikenali lewat `com.docker.compose.project` seperti
  `MonitoringService.sampleAll()`) — keduanya di-resolve lewat **satu** query `compose_apps` (id/slug → project_id) untuk **semua** project sekaligus (bukan N+1 per project/per kartu).
  `buildProjectUsage()` (`project-resource-usage.util.ts`, murni & di-unit-test) memakai ulang `aggregateMetrics()` (pola sama dengan jumlah task swarm/service compose) untuk
  menjumlahkan seluruh container sebuah project jadi satu seri, lalu mengubah counter jaringan kumulatif yang sudah dijumlahkan itu jadi **rate** bytes/detik dari dua tick
  sampler berurutan — angka kumulatif lintas container dengan waktu mulai berbeda tidak berarti apa-apa kalau tidak dikonversi ke rate; container yang keluar dari
  jumlah di tengah jalan (redeploy/stop) di-clamp ke 0, bukan dilaporkan negatif. **Live saja, tanpa riwayat tersimpan** (`24h`/`7d`/`30d` seperti endpoint metrik lain) —
  menambah retensi per project adalah pekerjaan terpisah (perlu skema rollup baru, bukan sekadar baca cache) dan belum diminta.

## Pemantauan server remote

- **Sampler** (`MonitoringService`, monitoring module — sekarang meng-import `ServerModule`): selain sapuan lokal 15 detik, tiap **30 detik** (`REMOTE_SAMPLE_INTERVAL_MS`; dua `stats`
  per container lewat SSH terlalu berat untuk 15 detik) `sampleRemote()` membaca daftar `servers` dan **memulai satu putaran per server tanpa menunggu yang lain**: `listContainers`
  (`aoox.component`, running) lewat `RemoteDockerService.forServer(id)` (sesi SSH yang di-cache — tidak ada koneksi baru per tick), lalu `sampleContainer` dengan paralelisme 3 per server.
  Putaran dibatasi `REMOTE_CYCLE_TIMEOUT_MS` 25 detik (`server/with-timeout.ts`) dan **tidak ditumpuk** (`remoteRunning`), jadi satu server lambat/mati hanya menahan putarannya sendiri;
  sapuan lokal tak tersentuh (diuji nyata: `docker pause` pada server remote → metrik database lokal tetap bertambah tiap 15 detik). Hasil disimpan di peta **terpisah**
  (`remoteHistory` + `remoteInfo` = label & serverId per container): sapuan lokal menghapus semua id yang tidak ia lihat, dan `managedTotals()`/host live tidak boleh menjumlahkan container
  mesin lain. id container Docker acak 256-bit, jadi tidak bentrok antar daemon. `metricsFor`/`sampledContainers` membaca keduanya, sehingga endpoint metrik aplikasi
  (`findContainerByName` di daemon remote + `metricsFor`) dan retensi jalan tanpa perubahan di sisi pemakai. `remoteContainers()` memberi label yang sudah ditangkap sampler ke
  `MetricRetentionService.ownersByContainer()` (owner dari `aoox.application/.database/.compose`) dan `ProjectResourceUsageService.containerProjectMap()` (`aoox.project`) — keduanya
  **tanpa panggilan SSH sendiri**, jadi kartu resource project dan riwayat 24h/7d/30d memuat aplikasi remote. Gagal menjangkau server → bacaannya dikosongkan (angka basi lebih buruk
  daripada kosong); container yang hilang dibuang; server yang dihapus dibuang di tick berikutnya (`forgetServer`).
- **Event `die`** (`server/remote-events.service.ts`, di-export `ServerModule`): satu stream `GET /events` (`type=container`, `event=die`, `label=aoox.component`) per server lewat terowongan
  yang sama, reconnect dengan backoff sendiri (1 s → 60 s, kembali ke 1 s bila sempat hidup > 30 s), `reconcile()` tiap 30 detik mengikuti tabel `servers` (mulai untuk server baru, hentikan untuk
  yang dihapus), dan **restart segera** saat `RemoteDockerService.forget(id)` dipanggil (`onForget` — kredensial diubah / test-server). Generasi (`generation`) membuat callback stream yang sudah
  diganti diabaikan, jadi tidak ada koneksi ganda. `ContainerDownNotifierService` berlangganan juga (`handle(event, serverId)`): aturan yang sama (grace 5 s, cooldown 10 menit per container,
  diabaikan bila container sudah diganti deploy / row `stopped` / exit 0) tetapi pengecekan ulang lewat daemon server itu; aplikasi yang sekarang ada di server lain atau server yang sudah dihapus
  diabaikan; database tidak pernah remote; pesan menyebut nama server (`Application went down: X on server NAME`, field `Server`, `data.server`). Server yang sendiri mati tidak bisa dicek ulang —
  itu tugas health check di bawah.
- **Kesehatan server** (`server/server-health.service.ts`, `@Cron` tiap menit): probe paralel per server (`listContainers` lewat terowongan, timeout 12 s) — jawabannya membuktikan server,
  SSH, dan Docker hidup, dan jumlahnya = "container dipantau". Hasil ditulis ke baris `servers` (`health_status` unknown|up|down, `health_checked_at`, `health_changed_at` = sejak kapan,
  `health_error`, `monitored_containers`; migrasi `ServerHealthAndMonitorToggles`) dan **itulah yang dibaca web** (`ServerDto.health`, tanpa panggilan ke server saat halaman dibuka).
  `down` butuh **2 kegagalan berturut-turut** (`DOWN_AFTER_FAILURES`); notifikasi `serverDown` (toggle `on_server_down`, **default `true`**: hanya relevan untuk yang menambah server) dikirim sekali,
  diingatkan maksimal 1×/jam selama masih down, dan **satu pesan pulih** ("Server reachable again", level `success`, `Down for`) lewat event & toggle yang sama (dibedakan level dan
  `data.event` `server.down`/`server.recovered`; paling sederhana dan sejajar dengan `dnsIssue`). Cek pertama yang sukses hanya menandai `up` (tak ada yang diumumkan). State in-memory
  (`failures`, `lastDownNotice`) dibersihkan untuk server yang hilang; **API restart saat server sudah down** tidak mengirim ulang (status dibaca dari DB, pengingat berikutnya 1 jam lagi).
- **Batas sengaja**: `disk-watcher`, `certificate-watcher`, retensi disk/`disk` card, dan DNS tetap hanya host lokal; compose/database/job tetap hanya host. Lama deteksi server mati ≈ 2 menit
  (cek tiap menit, dua gagal). Stream `die` dan sampler untuk server baru mulai paling lambat 30 detik setelah server ditambahkan.
- Diuji nyata dengan server simulasi terisolasi (`docker:dind` + sshd, image `docker save | load`): metrik CPU ~99% bergerak untuk aplikasi di server remote (live + rollup 24h) dan masuk
  resource usage project; container dimatikan → tepat satu notifikasi "on server …"; `docker pause` server → down setelah dua cek + satu notifikasi, unpause → satu notifikasi pulih;
  server yang tak terjangkau (IP blackhole) tidak menghambat yang lain; hapus server menghentikan stream-nya.

## Monitor HTTP per aplikasi

- `src/modules/http-monitor/` — pemeriksaan HTTP **opsional** per aplikasi (container hidup tapi 5xx/macet tidak tertangkap `container-down`). Entity `HttpMonitor` (`http_monitors`, satu per
  aplikasi, FK cascade): `enabled`, `path` (default `/`), `interval_minutes` 1–60 (5), `timeout_seconds` 1–30 (10), `expected_codes` (`200-399`; daftar kode/rentang), `failure_threshold` 1–10 (2),
  `use_internal`, **plus state hidup** (`status` unknown|up|down, `consecutive_failures`, `status_since`, `last_*`, `last_alert_at`) — state ikut di baris itu sehingga **API restart tidak melupakan
  outage yang berlangsung dan tidak mengumumkan app sehat sebagai down** (diuji nyata: restart di tengah outage → tidak ada alert baru, pulih tetap terkirim). `HttpCheck` (`http_checks`, hanya hasil:
  waktu, ok, kode, latensi, error ≤ 200 char — **isi respons tidak pernah disimpan**) dan `HttpIncident` (`http_incidents`: mulai dari cek gagal **pertama** di rangkaian, selesai saat sehat; baris terbuka
  = outage sedang berlangsung). Migrasi `HttpMonitors` (+ kolom `on_http_down`).
- **SSRF — hanya path yang berasal dari pengguna**. Host **tidak pernah** dari request (DTO `forbidNonWhitelisted`: `host`/`url` = 400): `resolveTarget()` menurunkannya dari aplikasi itu sendiri —
  domain pertama (URL publik lewat proxy, port proxy dipakai bila bukan 80/443; `useInternal` melewatinya), lalu app di server remote → `Server.host:hostPort`, app lokal di dalam Docker
  (`/.dockerenv`, mode container) → `http://aoox-app-<appName>:<containerPort>` di jaringan `aoox`, selain itu `127.0.0.1:hostPort`; tanpa semuanya → "no reachable address" (masalah konfigurasi:
  ditampilkan di UI, **tidak pernah** alert). `validateMonitorPath()` (`http-probe.ts`, pure, di-unit-test luas): awalan `/` tunggal (bukan `//`/URL absolut), ≤ 200 char, tanpa kontrol/spasi/`\`/`#`, tanpa
  segmen `..` (juga yang di-percent-encode); lalu URL final dicek `origin` sama dengan basis. `probe()`: `fetch` `redirect: 'manual'` dengan timeout keras (`AbortSignal.timeout`), maks 3 redirect
  dan **hanya ke hostname + port yang sama** (`sameService`; redirect ke host/port lain tidak diikuti, 3xx-nya yang dinilai — diuji: `Location: http://169.254.169.254/…` → 302 tercatat dalam 18 ms, tidak
  diikuti), badan dibaca paling banyak 64 KB lalu dibuang, galat dipendekkan (`ECONNREFUSED`, `timeout after 5s`). Yang diuji adalah **dari mesin panel**: tidak membuktikan aksesibilitas dari internet luar,
  dan dengan domain publik bisa kena hairpin NAT — UI menampilkan target yang dipakai + catatan itu.
- **Penjadwal**: `@Cron('* * * * *')` `tick()` memilih hanya monitor **jatuh tempo** (`isDue`, slack 10 s; waktu tick dipakai sebagai `lastCheckedAt` supaya interval 1 menit tidak melorot), bukan
  satu timer per app; pool `CHECK_CONCURRENCY` 5; `inFlight` mencegah tumpang tindih; tick yang belum selesai tidak ditumpuk. Hanya aplikasi `running`; aplikasi stopped/error **tidak dianggap down**
  (state di-reset ke `unknown`, incident terbuka ditutup tanpa pesan pulih). **Deploy**: dilewati selama ada deployment aktif (`queued/building/pushing/starting`) dan `POST_DEPLOY_GRACE_MS` 60 s sesudah
  deployment selesai; rangkaian gagal yang menyeberangi deploy di-reset (outage `down` dibiarkan). Retensi `@Cron('17 * * * *')`: hasil > 7 hari dan > 10 080 baris per monitor (1/menit/minggu) dihapus,
  incident > 50 per monitor dipangkas.
- **State & alert** (`monitor-state.ts` `nextState`, pure): `down` setelah `failure_threshold` kegagalan berturut-turut, sehat reset seketika; `unknown→up` diam. Event `httpDown` (toggle `on_http_down`,
  **default `true`** — monitor-nya sendiri opt-in per aplikasi): satu pesan `http.down` saat threshold tercapai, pengingat maks 1×/6 jam selama masih down (`last_alert_at` persisten), satu pesan
  `http.recovered` (level `success`, `Down for`) saat sehat — event & toggle yang sama (paling sederhana, sejajar `serverDown`). Pesan hanya memuat nama app, project, target (URL tanpa kredensial),
  kode/galat singkat, dan tautan ke aplikasi.
- **Statistik** (`view()`): uptime 24 jam/7 hari = cek sehat / total dari `http_checks`; latensi rata-rata dan p95 dari cek **sehat** 24 jam; `series` 24 jam dalam ≤ 120 bucket (rata-rata latensi + jumlah
  gagal per bucket) untuk sparkline; 10 incident terakhir dengan durasi.
- **API** (`/applications/:id/monitor`): `GET` (config, target, status, statistik, series, incidents; semua anggota), `PUT` (developer+, viewer 403 lewat cek tulis project), `POST …/check` (throttle
  10/menit, "periksa sekarang": butuh config tersimpan dan app `running`, hasil tercatat & bisa alert). Ekspor/impor project membawa **konfigurasi** (`httpMonitor`, tanpa state/riwayat, opsional di berkas
  lama; impor memvalidasi tiap nilai seperti request dan jatuh ke default dengan warning). Hapus aplikasi → FK cascade menghapus monitor, hasil, dan incident.
- Belum: halaman status publik (butuh keputusan privasi; usulan: opt-in per project, token tak tertebak, hanya nama + status), target berbasis swarm service tanpa domain/port host, badge status monitor di
  kartu aplikasi halaman project, uji dari banyak lokasi.

## Managed database

- `src/modules/managed-database/` — entity `ManagedDatabase` (di bawah `Project`; engine `postgres`|`mysql`|`mariadb`|`redis`|`valkey`|`mongodb`, `variant`
  (hanya untuk `postgres`: `pgvector`|`postgis`|`timescaledb`|null), `image_tag`, `db_slug` unik, `password_encrypted` `select: false`, `host_port` opsional,
  status `creating`→`running`|`stopped`|`error`).
- `engines.ts` = resep per engine mengikuti env resmi image Docker Hub (`POSTGRES_*`, `MYSQL_*`, `MARIADB_*`, redis/valkey `--requirepass`), port, path data, dan format URL.
  **Valkey** = drop-in Redis (fork Linux Foundation): resep identik dengan redis (`valkey-server --requirepass ... --appendonly yes`, url `redis://`) — image-nya
  terverifikasi punya **kedua** binary `valkey-cli` **dan** `redis-cli` (symlink), jadi seluruh kode yang shell-out ke `redis-cli` (backup, data browser) jalan
  tanpa modifikasi; hanya setiap `if (engine === 'redis')` yang perlu diperluas jadi `|| engine === 'valkey'` (semuanya di `data-browser/database-query.service.ts`
  dan `schemas.service.ts`, sengaja lewat pengecekan literal per lokasi bukan helper terpusat, supaya `Record<DatabaseEngine, ...>` di `engines.ts`/`backup-recipes.ts`
  tetap memaksa exhaustiveness compiler saat ada engine baru lagi nanti). **Varian PostgreSQL** (`POSTGRES_VARIANTS` di `engines.ts`, tipe `PostgresVariant`):
  protokol/env/URL/backup (`pg_dump`/`pg_dumpall`) sama persis dengan postgres polos — hanya `imageNameFor(engine, variant)`/`defaultTagFor(engine, variant)`
  yang berbeda (dipakai di `managed-database.service.ts` provision, `database-backup.service.ts`, dan data browser `spawn()`, ketiganya sebelumnya hardcode
  `ENGINES[engine].image` langsung). Tag Docker Hub diverifikasi nyata: `pgvector/pgvector:pg16`, `postgis/postgis:16-3.4`, `timescale/timescaledb:latest-pg16`.
  Ekstensi diaktifkan sekali lewat `ManagedDatabaseService.activateVariantExtension()` (`CREATE EXTENSION IF NOT EXISTS ...`, di container helper sekali-jalan
  dengan `pg_isready` loop dulu — `provision()` sendiri tidak menunggu Postgres siap, cuma menunggu container start) setelah container start; gagal hanya di-log
  warning, tidak menggagalkan provisioning (database tetap bisa dipakai tanpa ekstensinya). **Diuji nyata**: pgvector (ekstensi + kolom `vector` + insert +
  backup `pg_dump`/restore `psql` penuh, data kembali setelah wipe), PostGIS & TimescaleDB (image resminya sudah mengaktifkan ekstensi sendiri saat init —
  panggilan `CREATE EXTENSION IF NOT EXISTS` di sini jadi no-op idempoten dengan NOTICE, bukan error; TimescaleDB juga diuji `create_hypertable()` + insert + select),
  Valkey (siklus penuh backup `redis-cli --rdb` → wipe volume → restore lewat manifest AOF yang sama dengan Redis → data kembali). Ganti engine/varian setelah
  dibuat **tidak didukung** dari dashboard (hapus + buat ulang, opsional restore backup ke yang baru).
  **MongoDB** sengaja jadi `engine: 'mongodb'` tersendiri (bukan varian) — protokol/tooling backup sama sekali beda dari SQL. Mongo membuat database secara
  **lazy** (tanpa `CREATE DATABASE` — database baru "ada" begitu punya isi), jadi `ManagedDatabaseService.initMongoDatabase()` (dipanggil di `provision()` setelah
  start, pola sama dengan `activateVariantExtension`: container helper sekali-jalan, loop `mongosh --eval "db.adminCommand('ping')"` menunggu server siap, kredensial
  lewat `Env` bukan diinterpolasi ke script) menulis satu dokumen placeholder ke koleksi `_aoox_init` supaya database utama langsung muncul di `schemas/` tanpa
  menunggu tulisan pertama dari aplikasi; gagal hanya di-log warning. `SchemasService.engineOf()` punya cabang `'mongodb'` sungguhan (bukan ditolak seperti
  redis/valkey) — `mongoDatabaseNames`/`mongoCreateDatabase`/`mongoDropDatabase` (`DatabaseQueryService`) lewat `db.adminCommand({listDatabases:1,...})`/
  `insertOne`/`dropDatabase`. `BACKUP_RECIPES.mongodb` pakai `mongodump`/`mongorestore --archive --gzip` (gzip bawaan mongodump, tanpa wrapper `gzipped()`);
  `restoreAll` menolak `admin`/`local`/`config` lewat `--nsExclude` supaya restore server penuh tidak pernah menimpa kredensial root user. Diuji nyata: provision
  → init placeholder → `mongoFind` → backup → wipe (`dropDatabase`) → restore → data kembali, semuanya lewat HTTP API sungguhan (bukan cuma `docker exec` manual).
- `managed-database.service.ts`: container `aoox-db-<slug>` di network `aoox` + volume `aoox_db_<slug>`, label compose; provisioning **detached**
  (`provisionInBackground`, pull image bisa lama) → status `running`/`error`. `connection()` memberi URL internal (host = nama container) dan eksternal (bila port host dipublikasikan).
- Flow: `create-database` (202), `list-databases?projectId`, `get-database` (+ state container), `database-credentials` (password & URL — terpisah agar list tidak membawa rahasia),
  `delete-database?purge=`, `start/stop-database`. Aplikasi memakai DB dengan menyalin URL internal ke env-nya (belum ada injeksi otomatis).
- **Data browser** (`data-browser/`, tahap 1 "phpMyAdmin sederhana"): `GET /databases/:id/tables`, `GET /databases/:id/tables/:table/rows?schema&limit&offset&orderBy&dir`,
  `POST /databases/:id/query {sql}` (throttle 60/menit). `database-query.service.ts` menjalankan `psql --csv -P null='\N'` / `mysql --batch` / `redis-cli --json`
  di container sekali-jalan image engine (pola backup: tanpa driver DB di API, kredensial via env); stdout/stderr ditulis ke file dan dibaca lewat archive API
  (log container menambah timestamp & merusak CSV multi-baris), container di-kill setelah 30 s. Parser `query-output.ts` (`parsePsqlCsv` RFC 4180 — NULL = `\N` tak berkutip,
  `parseMysqlBatch` — NULL = kata `NULL`; keduanya pure & di-unit-test). Guard `query-guard.ts`: satu statement (`;` di luar kutip → 400), identifier tabel/kolom divalidasi
  + di-quote, SELECT tanpa LIMIT dibungkus `LIMIT 501` (`MAX_ROWS` 500 + flag `truncated`), timeout engine 15 s (`PGOPTIONS -c statement_timeout` / `max_execution_time` /
  MariaDB `max_statement_time`). **Hak tulis**: member hanya read — statement non-read ditolak 403 *dan* sesi engine dibuat read-only (`default_transaction_read_only=on` /
  `SET SESSION TRANSACTION READ ONLY`; diuji: `WITH … DELETE` dari member gagal di engine); owner/admin boleh tulis (INSERT/UPDATE/DELETE/DDL) — tag perintah psql (`UPDATE 3`,
  `CREATE TABLE`) dikembalikan sebagai `message`. Redis: `tables` = key hasil `SCAN 0 COUNT 500`, `rows` = isi key per tipe (GET/HGETALL/LRANGE/SMEMBERS/ZRANGE),
  `query` = satu perintah (`tokenize` menghormati kutip; whitelist `REDIS_READ_COMMANDS` untuk member; `error:"…"` redis-cli → 400). Image `mariadb` hanya punya CLI `mariadb`
  (tanpa alias `mysql`) — `sql()` memilih CLI per engine.
- **Data browser untuk MongoDB**: `mongo()` (private helper) menjalankan `mongosh --eval` di container sekali-jalan dan membungkus **setiap** ekspresi dalam
  `EJSON.stringify((expr), {relaxed: true})` secara terpusat sebelum eval — output default mongosh untuk nilai bukan-string adalah format shell-inspect
  (`[ 'a', 'b' ]`), bukan JSON, jadi tanpa pembungkusan ini `JSON.parse` di sisi API gagal untuk `listTables`/`mongoDatabaseNames`/`mongoCreateDatabase`/
  `mongoDropDatabase` (ditemukan lewat run Docker sungguhan, bukan dari unit test — `mongoFind` kebetulan lolos karena sudah membungkus sendiri sebelum
  perubahan ini). `listTables` = `db.getCollectionNames()`, `tableRows`/`exportTableCsv` lewat `mongoFind()` + `mongoDocsToRows()` (fungsi murni & di-unit-test:
  union key di seluruh batch urutan first-seen, `_id` dipin pertama, nilai bukan-string di-`JSON.stringify`). `columns()`/`updateRow()`/`deleteRow()`/ekspor
  &impor SQL semuanya menolak 400 (skema bebas, belum didukung). Query box hanya `<koleksi>.find({...})` (`buildMongoFindScript()`, fungsi murni & di-unit-test):
  filter di-`JSON.parse` ketat lalu di-`JSON.stringify` ulang sebelum ditempel ke script `mongosh` yang di-generate — itulah yang mencegah filter seperti
  `{}); db.dropDatabase(); ({` lolos dari pemanggilan `.find(...)` dan berjalan sebagai JS mongosh bebas (hanya literal JSON valid yang bisa lolos `JSON.parse`,
  jadi yang sampai ke shell selalu data mati). Operator extended-JSON (`{"$oid":"..."}`) belum diterjemahkan khusus di filter (jadi cuma memfilter field bernama
  literal `$oid`, bukan error). **Belum**: insert/update/delete/aggregate lewat query box (baca-saja untuk sekarang), tab Struktur/buat-koleksi/edit-hapus baris
  di web (backend menolak 400, web tidak pernah memanggilnya untuk engine ini).
- **Data browser tahap 2** (struktur tabel, edit/hapus baris, ekspor CSV, riwayat query): `GET /databases/:id/tables/:table/columns` → `ColumnInfoDto[]` (name/dataType/nullable/
  defaultValue/isPrimaryKey) dari `information_schema.columns` (Postgres: PK lewat `EXISTS` ke `table_constraints`+`key_column_usage`; MySQL/MariaDB: `column_key = 'PRI'`),
  dipakai tab **Struktur** di web dan sebagai sumber kebenaran validasi edit — **bukan** `assertIdentifier` yang menolak spasi/non-ASCII (kolom seperti `"first name"` valid di
  Postgres); nama kolom di `set`/`where` divalidasi terhadap daftar kolom nyata ini.
  `PATCH`/`DELETE /databases/:id/tables/:table/rows` (owner/admin, body `{where, set?, db?, schema?}`): `query-guard.ts` `assertRowTarget(columns, where, set)` menuntut `where`
  **persis** primary key — tidak boleh subset (bisa kena banyak baris) atau superset (filter basi tersembunyi) — dan menolak `set` yang menyentuh kolom PK itu sendiri atau kolom
  tak dikenal; tabel tanpa PK → 400 "edit dengan SQL". Statement dibangun via `sqlLiteral()` (quote+escape manual — nilai berasal dari body JSON tervalidasi, bukan SQL user) dan
  dijalankan lewat `this.sql()` yang sama dengan query box. **Jaminan tepat satu baris**: Postgres dibaca dari tag perintah (`UPDATE 1`/`DELETE 1`); mysql/mariadb (CLI batch tidak
  mencetak status) mendapat `SELECT ROW_COUNT()` tambahan dalam skrip yang sama (satu sesi CLI) — `affected !== 1` → 400. MySQL juga menambahkan `LIMIT 1` sebagai lapis kedua.
  Diuji nyata di Postgres **dan** MariaDB (jalur `ROW_COUNT()`): PK komposit (update/delete tepat 1 baris), tabel tanpa PK (400, bukan update seisi tabel), kolom bernama
  `"first name"` (edit berhasil, bukan 500), `where` subset/superset PK (400), ubah kolom PK (400), `where` PK yang tidak ada (0 baris → 400, bukan sukses palsu),
  viewer PATCH/DELETE (403 dari `@Roles`). Catatan: `columns()` MySQL/MariaDB memakai `table_schema = DATABASE()` dan mengabaikan `opts.schema` (MySQL tidak punya schema
  di dalam database seperti Postgres, sama seperti `listTables`) — tidak tercapai lewat web karena `TableInfo.schema` selalu null untuk engine itu, tapi kalau dipanggil manual
  dengan `schema` untuk MySQL, `columns()` dan `tableRef()` (yang menghormati `schema`) bisa melihat objek berbeda.
  `GET /databases/:id/tables/:table/rows/export` → CSV (`toCsv()` RFC 4180, `MAX_EXPORT_ROWS` 5000 terpisah dari `MAX_ROWS` 500 query; header `X-Aoox-Truncated` bila
  dipotong), diproksi web lewat `/api/databases/[id]/tables/[table]/rows/export` (cookie → Bearer) seperti ekspor SQL.
  **Riwayat query** (`src/modules/managed-database/query-history/`, entity `QueryHistoryEntry` di `query_history`: FK cascade ke database & user, `sql` teks apa adanya —
  **tanpa redaksi**, tidak seperti audit log yang punya nama key tetap untuk di-redact; SQL bebas format jadi dicatat verbatim dan dipotong 4 KB, ini properti yang disengaja
  bukan celah, karena hanya pemilik baris yang melihatnya): ditulis fire-and-forget dari `DataBrowserController.query()` (sukses *dan* gagal, agar riwayat "apa yang baru saja
  kupanggil" lengkap) setelah `runQuery()`, tidak pernah menggagalkan response query. `QUERY_HISTORY_KEEP` 50 baris per (database, user), dipangkas tiap tulis seperti
  `compose-runner` `prune()`. Flow `GET`/`DELETE /databases/:id/query-history` — **per user**, tanpa `@Roles` (member melihat riwayatnya sendiri, sama seperti query box),
  berbeda dari `/audit-logs` yang platform-wide owner/admin.
- **Banyak database per server** (`schemas/`): `GET /databases/:id/schemas` (semua member) → `[{name, isPrimary}]` (`pg_database` non-template / `SHOW DATABASES`, minus
  `SYSTEM_SCHEMAS`), `POST` (owner/admin; Postgres `CREATE DATABASE … OWNER <user>` — user provisioning adalah superuser; MySQL/MariaDB `CREATE DATABASE` + `GRANT ALL … TO 'user'@'%'`
  agar URL koneksi tinggal ganti nama db; MongoDB tidak butuh grant terpisah — `mongoCreateDatabase` cukup menulis satu dokumen placeholder, user root sudah punya akses ke semua
  database), `DELETE /:name` (owner/admin; primary & sistem ditolak; Postgres `WITH (FORCE)`; MongoDB `db.dropDatabase()`). Redis/Valkey → 400 (db bernomor, bukan nama).
  Data browser menerima `?db=` / `{db}` (`DatabaseSelectDto`) → `DatabaseQueryService.sql(db, stmt, {database})` menimpa `DB_NAME` di env helper (entri terakhir menang).
  Env app: `${{database.<slug>.url:<nama>}}` / `.database:<nama>` → URL/nama database lain di server yang sama (`REFERENCE` punya grup `:name`; cache per `slug:name`).
  Backup: `ManagedDatabase.backupAllDatabases` (PATCH `backup-schedule`) → `DatabaseBackup.scope` `all` (file `*.all.<ext>`): Postgres `pg_dumpall --clean --if-exists`, restore ke db
  `postgres` tanpa `ON_ERROR_STOP` (DROP DATABASE gagal selagi app terhubung — objek lalu diganti in-place); MySQL/MariaDB `mysqldump --databases <non-sistem> --add-drop-database`
  (bukan `--all-databases`, supaya tabel grant `mysql` tidak ikut), restore tanpa nama db; MongoDB `mongodump` tanpa `--db` (seluruh server) lalu `mongorestore --nsExclude`
  `admin`/`local`/`config` supaya root user tidak ikut ditimpa. Diuji E2E di Postgres & MariaDB (drop db → restore → data kembali), dan manual untuk MongoDB
  (`admin.system.users` tetap utuh setelah restore-all).
- **Ekspor/impor SQL** (data-browser): `GET /databases/:id/export?db=` men-stream `pg_dump --no-owner --no-privileges --clean --if-exists` / `mysqldump`/`mariadb-dump`
  polos (tanpa gzip, tanpa row backup) sebagai `<slug>[-db].sql` — `DatabaseQueryService.spawn()` (create+seed `/in` via `putArchive`+start+wait, timeout 30 menit untuk
  transfer) lalu `streamFileFromContainer('/out/stdout')`. `POST /databases/:id/import?db=` (owner/admin, throttle 10/menit, multipart `file` via `FileInterceptor` —
  `@types/multer` dev dep sesuai docs Nest; maks `IMPORT_MAX_BYTES` 64 MB karena file di-tar di memori) → `psql -v ON_ERROR_STOP=1 -f` / `mysql <`; gagal di statement
  pertama yang error → 400 dengan pesan engine, statement sebelumnya tetap berlaku (perilaku CLI; tanpa transaksi pembungkus). Web mem-proxy ekspor lewat
  `/api/databases/[id]/export` (cookie → Bearer) dan impor lewat server action multipart (`importSqlAction`). Redis/Valkey dan MongoDB tidak punya SQL untuk
  di-ekspor/impor — keduanya ditolak 400 (`dumpScript()`/`importSql()`; pakai backup/restore sebagai gantinya).

## Backup database

- `src/modules/database-backup/` — entity `DatabaseBackup` (`database_backups`, FK cascade ke `managed_databases`; `filename` = `<slug>/<ISO stamp>.<ext>`,
  status `running`→`success`|`failed`, `trigger` `manual`|`scheduled`, `size_bytes`). `ManagedDatabase` punya `backup_cron` (null = nonaktif) & `backup_keep` (default 7).
- Semua dump ada di **satu volume** `aoox_backups`, di-mount `/backups` ke container sekali-jalan dari image engine itu sendiri (`backup-recipes.ts`:
  `pg_dump | gzip`, `mysqldump`/`mariadb-dump` sebagai root, `redis-cli --rdb`, `mongodump --archive --gzip`). Kredensial hanya lewat env
  (`DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME BACKUP_FILE`), tidak di `Cmd`.
- Restore SQL = `online` (stream ke `psql`/`mysql`). MongoDB juga `online` (`mongorestore --archive --gzip --drop`, tidak perlu stop container). Redis/Valkey =
  `offline-volume`: container di-stop, volume data di-mount ke `/data`, snapshot dipasang sebagai
  **base file multi-part AOF** + manifest (Redis 7 dengan `appendonly yes` mengabaikan `dump.rdb`), lalu container di-start lagi (`finally`).
- Unduh/hapus file lewat helper `busybox:stable` (`GET /containers/{id}/archive` → `SingleFileUntar` di klien Docker; `DockerService.runOnceWithOutput` untuk exit code + output).
- Jadwal: `backup-scheduler.service.ts` (`@nestjs/schedule@6` + `SchedulerRegistry`/`CronJob` dari `cron`), job per DB didaftarkan saat boot dan `reschedule(db)` saat jadwal diubah;
  setelah backup terjadwal, `prune(db)` menghapus backup **terjadwal** tertua melebihi `backupKeep` (manual tidak pernah dipangkas). Cron divalidasi `isValidCron` → 400.
- Flow: `create-backup` (`POST /databases/:id/backups`, 201, sinkron), `list-backups`, `restore-backup` (`POST /backups/:id/restore`), `download-backup` (stream, `Content-Disposition`),
  `delete-backup` (row + file), `update-backup-schedule` (`PATCH /databases/:id/backup-schedule`). Web mem-proxy unduhan lewat `/api/backups/:id/download` (cookie session → Bearer).
- Resep dump SQL memakai file sementara lalu gzip (`gzipped()` di `backup-recipes.ts`): `dump | gzip` melaporkan exit code gzip, sehingga dump gagal menghasilkan backup "sukses" 20 byte;
  `pipefail` tidak ada di dash, jadi status dump dipropagasi manual. Backup gagal → notifikasi `backupFailure`.
- **Tujuan S3** (`src/modules/backup-destination/`, entity `BackupDestination` di `backup_destinations`: endpoint nullable = AWS, region, bucket, prefix, `access_key_id`,
  `secret_access_key_encrypted` `select:false`, `force_path_style` default true). Flow `create/delete/test-destination` (owner/admin), `list-destinations` (semua member — DTO tanpa secret,
  dipakai select di halaman DB). Transfer lewat container sekali-jalan **`rclone/rclone:1`** (file tidak lewat proses API): konfigurasi remote murni via env
  `RCLONE_CONFIG_S3_*` (`rcloneEnv()`, pure & di-unit-test; `provider=Other` bila ada endpoint, `AWS` bila tidak; `NO_CHECK_BUCKET=true` — bucket harus sudah ada), volume backup
  di-mount `:ro`, di network `aoox` (MinIO self-hosted bisa dipanggil pakai nama container). `upload` = `copyto`, `remove` = `deletefile` (tidak pernah throw — prune tak boleh macet),
  `test` = `lsjson --max-depth 1` (output JSON multi-baris, di-parse dari baris `[` pertama).
  `ManagedDatabase.backupDestinationId` (FK SET NULL; diset lewat `PATCH /databases/:id/backup-schedule` `backupDestinationId`) → tiap backup (manual & terjadwal) setelah dump lokal sukses
  diunggah; `DatabaseBackup.destinationId` + `remoteKey` (`<prefix>/<slug>/<stamp>.<ext>`). Gagal unggah = backup `failed` + notifikasi (file lokal tetap ada untuk diunduh) —
  tujuan dipasang supaya salinan ada di tempat lain. Hapus/prune backup juga menghapus objek remote. Konstanta volume di `backups-volume.ts` (dipakai kedua module).
- **Backup volume aplikasi** (`src/modules/volume-backup/`, entity `VolumeBackup` di `volume_backups`: FK app & mount cascade, `volume`, `filename` `<appName>/<mount>/<stamp>.tar.gz`,
  status/trigger/size/destination/remoteKey seperti backup DB). `Application` punya `backup_cron`/`backup_keep`/`backup_destination_id` (jadwal berlaku untuk **semua** mount `volume`,
  prune per mount). Backup = busybox sekali-jalan dengan volume di-mount `:ro` + `tar czf` ke `aoox_backups`; restore = stop container → `rm -rf ./* ./.[!.]* ./..?*` → `tar xzf` →
  start lagi (`finally`). Unduh/hapus/upload S3 memakai mekanisme yang sama dengan backup DB. Hanya app di **server lokal** (400 untuk `serverId`). Flow `create-volume-backup`
  (`POST /applications/:id/mounts/:mountId/backups`, sinkron), `list-volume-backups`, `restore/download/delete-volume-backup` (`/volume-backups/:id`), `update-volume-backup-schedule`
  (`PATCH /applications/:id/backup-schedule`, DTO yang sama dengan DB). Web: `volume-backups.tsx` di bawah tab Mount + proxy `/api/volume-backups/:id/download`.
- **Restore dari S3** (`backup-files.service.ts`, di-export `DatabaseBackupModule`, dipakai juga volume-backup): `localFiles()` = satu `find` busybox di volume backup →
  `annotate(rows)` menambah `local: boolean` ke `GET .../backups` dan `.../volume-backups`; `ensureLocal(backup)` dipanggil sebelum restore/download — bila file lokal hilang
  (dipangkas retensi, disk baru) dan ada `remoteKey`, `BackupDestinationService.download()` (`rclone copyto` remote → volume) menariknya kembali; tanpa salinan → 400 (restore) / 404 (download).
  Web menandai "hanya di S3". Belum: retensi terpisah di S3, backup bind mount, impor backup yang rownya sudah tidak ada di DB (server baru total).

## Template (one-click)

- `src/modules/template/` — katalog **statis dalam TypeScript** (`templates/*.ts`, `Template` di `template.types.ts`: id, versi, `variables` `{key,label,default,generate,required,hint}`,
  `services` `{service,port,label}` yang boleh diberi domain, `compose`). Tidak diambil dari URL saat runtime (offline & tidak bisa diganti YAML pihak lain); tidak perlu `assets` nest-cli.
  Isi (14): wordpress, ghost, n8n, uptime-kuma, minio, gitea, **vaultwarden** (1.37.3), **umami** (`ghcr.io/umami-software/umami:postgresql-v2.20.2` + postgres), **grafana** (13.0.2, SQLite),
  **metabase** (v0.63.18.5 + postgres), **directus** (12.4.1 + postgres; variabel bernama `KEY`/`SECRET` memang nama env Directus), **mattermost** (`mattermost-team-edition:11.11.1` + postgres) dan
  **nextcloud** (`32.0.15-apache` + postgres + redis `--requirepass` + service `cron` dengan `entrypoint: /cron.sh`; `PROTOCOL` default https untuk `OVERWRITEPROTOCOL`, http hanya uji lokal).
  **odoo** (`odoo:19.0-20260926` Community + postgres; tag bertanggal karena `19.0` bergeser tiap malam; konfigurasi lewat compose `configs` inline -> `/etc/odoo/odoo.conf`
  karena master password (`admin_passwd`) hanya bisa lewat file config, bukan CLI/env; `proxy_mode`, `workers = 0`, `list_db = True` supaya database pertama bisa dibuat lewat web;
  variabel `MASTER_PASSWORD` di-generate; healthcheck `/web/health`; pengamanan `/web/database/manager` setelahnya = edit compose: `list_db = False` + `dbfilter`; wizard `POST /web/database/create`
  Odoo 19 mewajibkan field `phone`). Diuji: master password yang dihasilkan diterima, yang salah ditolak, login admin, data bertahan setelah recreate.
  Konvensi template baru: tag image versi tertentu (spec menjaga tiap image punya tag eksplisit), DB memakai `healthcheck` `pg_isready` + `depends_on: condition: service_healthy`, volume bernama,
  logo simple-icons. Semua diuji nyata lewat `POST /compose-apps/from-template` di belakang proxy lokal (endpoint health/status menjawab 200; login Directus; data Grafana/Umami selamat dari recreate
  container; Nextcloud memakai pgsql+Redis). Catatan: `/server/health` Directus 403 tanpa token — pakai `/server/ping`. `GET /templates` (semua member).
- `template.service.ts`: `renderEnv(template, values)` (nilai user → default → `generateValue` untuk `generate`; `required` kosong → `TemplateVariableError` → 400),
  `generateValue` **alfanumerik saja** (masuk `.aoox.env` = sumber interpolasi compose `$`, dan lewat `EnvResolverService` `${{`), `referencedVariables`.
  Spec `template.service.spec.ts` menjaga katalog: id unik, tiap service ada di compose, `${VAR}` di compose == `variables`, key PASSWORD/SECRET/KEY selalu `generate`.
- Flow di compose module: `create-from-template/` (`POST /compose-apps/from-template` `{projectId, templateId, name?, variables?, serviceDomains?}`, 202) → row `source: 'template'`
  + `templateId` + `composeContent` disalin + env hasil `renderEnv` + domain (divalidasi terhadap `template.services`), lalu `runner.start(app,'deploy')`. DTO create git biasa tidak dipakai (regex `gitUrl`).
- Web: `/templates` (`templates-catalog.tsx` + `deploy-template-dialog.tsx`: project, nama, host per service + HTTPS, field variabel); halaman compose menampilkan `compose-domains.tsx`
  dan `ComposeForm source="template"` (textarea compose, tanpa field git). Belum: template dari repo/URL kustom, versi/upgrade template, ikon offline.

## Scheduled jobs

- `src/modules/job/` — entity `Job` (`jobs`, di bawah `Application`: `name`, `cron` nullable = manual saja, `command` dijalankan `sh -c`, `target` `container`|`run`, `enabled`,
  `timeout_seconds` default 600, `last_run_at`/`last_status`) dan `JobRun` (`job_runs`: status `running`→`success`|`failed`|`timeout`, `trigger` manual|scheduled, `exit_code`,
  `output` dipotong 64 KB; `JOB_RUN_KEEP` 50 run terakhir per job).
- `job-runner.service.ts`: `container` = `DockerEngineClient.execWithCode` (exec + `GET /exec/{id}/json` untuk `ExitCode`) di container app yang running; `run` = container sekali-jalan
  dari `currentImage` dengan env ter-resolve, mount, limit sumber daya, label `aoox.component=job` (diabaikan monitoring/container-down), dihapus setelah selesai (stop bila timeout).
  **Timeout** ditegakkan di dalam container lewat `timeout` bila ada (`shellCommand`, perintah dilewatkan sebagai `$0` supaya tanda kutip bebas); API hanya menyerah menunggu setelah
  `timeout+30 s` (exec tidak bisa di-kill dari luar). Jebakan yang ditemukan: `timeout` **tidak boleh jadi perintah terakhir** skrip `sh -c` — ash/dash tail-exec sehingga `timeout` menjadi
  PID 1 di container sekali-jalan dan sinyalnya tidak sampai ke anak (perintah jalan sampai habis); karena itu skrip diakhiri `; exit $?`. Busybox `timeout` mengembalikan 143 (bukan 124) →
  `isTimeoutExit(code, elapsed, limit)` = kode 124/137/143 **dan** durasi ≥ limit. Gagal/timeout → notifikasi `jobFailure`.
- `job-scheduler.service.ts`: satu `CronJob` per job aktif dengan `cron` (`reschedule`/`unschedule`, daftar ulang saat boot); tick dilewati bila job masih berjalan (`isActive`, tanpa antre).
- Flow: `create-job`/`list-jobs` (`/applications/:id/jobs`), `update-job`/`delete-job`/`run-job` (202, 409 bila masih jalan)/`list-job-runs` (20 terakhir) di `/jobs/:id`. Cron divalidasi → 400.
- Web: tab **Jobs** (`application-jobs.tsx`): baris job (toggle aktif, Jalankan, hapus; riwayat run di-poll 2 detik selama ada `running`, lalu `router.refresh()` agar header ikut) + form job baru.
  `src/features/job/`.
- **Pemilik job** = aplikasi **atau** database **atau** stack compose (`application_id`/`database_id`/`compose_app_id` nullable, tepat satu terisi; `service` untuk compose).
  `JobRunnerService.resolve(job)` → `JobContext` (`findContainer` + `runSpec`): app = container app / image `currentImage` + env + mount; database = container `aoox-db-<slug>`
  / image engine + env `DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME` (sama dengan resep backup — di dalam container DB tersedia env resmi image, mis. `$POSTGRES_USER`);
  compose = container berlabel `com.docker.compose.project`+`service` / image & env container itu (`inspect`, `Config.Env` ditambahkan ke tipe klien). `JobService.build(owner, dto, service)`
  dipakai `create-job` (`/applications/:id/jobs`), `create-database-job` (`/databases/:id/jobs`), `create-compose-job` (`/compose-apps/:id/jobs`, DTO `CreateComposeJobDto` mewajibkan
  `service` — jangan pakai `declare` di DTO turunan: dekorator validasinya tidak terdaftar). `ComposeModule` sekarang meng-export `ComposeService`.
  Belum: riwayat > 20 di UI, streaming output.

## Pemeliharaan disk

- `src/modules/maintenance/` — `MaintenanceService.usage()` (`GET /maintenance/disk`, owner/admin: `GET /system/df` diringkas + `reclaimableBytes` = image dangling + build cache
  non-shared, `prunableDeployments`, laporan cleanup terakhir **in-memory**) dan `cleanup()` (`POST /maintenance/cleanup {registryGc?}`, owner, sinkron, 409 bila sedang jalan;
  juga `@Cron('30 4 * * *')` kecuali `MAINTENANCE_NIGHTLY=false`). Urutan: per aplikasi hapus deployment sukses melebihi `Application.deploymentKeep` (default 10; **tidak pernah**
  `currentImage`, dan image yang masih dirujuk row yang disimpan — rollback memakai ulang ref — tidak dihapus; `imageRef` row lama di-null-kan, log tetap) → `DELETE /images/{ref}` +
  hapus tag di registry lokal (`getTag`+`deleteManifest`) → hapus row failed/queued > 30 hari → `POST /images/prune` (dangling) + `POST /build/prune` → GC registry (`SelfHostedRegistryService`,
  sekarang di-export). Klien Docker dapat `removeImage`, `pruneImages`, `pruneBuildCache`. Uji nyata: 17,7 GB dibebaskan, container app tak tersentuh. Web: `disk-card.tsx` di Settings
  (bar pemakaian, tombol Bersihkan untuk owner, toggle GC registry) dan field **Riwayat deployment** di form aplikasi. Belum: retensi riwayat monitoring, app di server remote
  (image lama dihapus di daemon server itu tapi tidak ada registry di sana).
- **Volume yatim** (`orphan-volumes.ts`, murni & di-unit-test — tanpa panggilan Docker): `expectedVolumes()` menghitung ulang, dari baris DB, setiap nama volume yang seharusnya
  masih ada (memakai ulang generator nama yang sama dengan runner: `volumeNameFor`/`filesVolumeFor` dari `mounts.ts`, `volumeNameForDb`, `composeVolumeFor`, plus lima volume
  singleton tetap seperti `aoox_buildkit`/`aoox_backups`) lalu dibandingkan ke `GET /system/df` daemon **lokal**. `isCandidateVolume()` **sengaja ketat** — hanya volume
  berawalan `aoox_app_`/`aoox_db_`/`aoox_compose_` atau salah satu dari kelima singleton itu yang pernah dianggap "milik aoox"; volume `aoox_` lain
  (mis. `aoox_postgres_data` — nama yang justru dihasilkan `docker-compose.dist.yml` untuk Postgres **milik panel sendiri**, karena stack itu diberi `name: aoox`)
  tidak pernah masuk pertimbangan sama sekali, apalagi dilaporkan. `MaintenanceService.usage()` menampilkan daftar nama sebagai pratinjau (`orphanVolumes`); `cleanup()` baru benar-benar
  menghapusnya lewat `DELETE /volumes/{name}` saat dipanggil dengan `pruneVolumes: true` — **default `false`**, termasuk di cron malam (beda dari `registryGc` yang default `true`),
  karena volume bisa menyimpan data yang tidak ada cadangannya di tempat lain, sedangkan image/build cache selalu bisa dibangun ulang. Hanya daemon lokal — volume di server remote
  tidak pernah disentuh. Diuji nyata terhadap dev DB: menemukan 4 volume yatim sungguhan (mount yang sudah dihapus tapi volume `_files` bersama tidak ikut terhapus, app/compose lama
  dari eksperimen sebelumnya) **dan** dengan benar mengabaikan `aoox_postgres_data` decoy yang sengaja ditanam — itulah satu-satunya jaminan yang wajib tidak pernah regresi.
  Web: `disk-card.tsx` menampilkan daftar + toggle "Sekalian hapus volume yatim" (hanya tampil kalau ada).

## Webhook masuk (keamanan tambahan)

- `webhook-ip-allowlist.ts` (application module, dipakai ulang compose seperti `webhook-signature.ts`): lapis kedua **opsional**, `WEBHOOK_VERIFY_GITHUB_IP=true` (default mati) —
  saat aktif, request yang teridentifikasi dari GitHub (header `X-GitHub-Event`/`X-Hub-Signature-256`) dan appnya sudah punya webhook secret harus juga datang dari salah satu rentang
  IP resmi GitHub (`GET https://api.github.com/meta` field `hooks`, di-cache 1 jam; gagal fetch → **fail-open**, tidak pernah mengubah outage GitHub jadi outage deploy). `ipInCidr()`
  murni & di-unit-test (IPv4 **dan** IPv6, termasuk menormalkan alamat IPv4-mapped `::ffff:a.b.c.d` yang muncul dari `req.ip` di socket dual-stack Docker). **Sengaja GitHub-only dan
  mati secara default**: GitLab tidak mempublikasikan rentang IP webhook yang stabil (GitLab self-hosted bisa di mana saja), dan GitHub *Enterprise Server* (self-hosted) juga mengirim
  `X-GitHub-Event` tapi dari jaringan pelanggan sendiri, bukan rentang github.com — menyalakan flag ini di sana akan menolak semua delivery asli. Diuji nyata terhadap `api.github.com/meta`
  sungguhan (bukan mock): delivery bertanda tangan valid dari `127.0.0.1` ditolak 401 (`::ffff:127.0.0.1` di luar rentang), delivery GitLab dengan token yang sama dari alamat yang sama
  tetap lolos (IP tidak pernah dicek untuk GitLab). Berlaku untuk webhook aplikasi maupun compose.

## Ekspor/impor project

- `src/modules/project-transfer/` — format sendiri (`project-export.types.ts`: `format: 'aoox-project'`, `version: 1`). Tanpa id: referensi ke objek platform
  (registry, git credential, tujuan backup, server) dibawa **berdasarkan nama** dan dicocokkan saat impor; yang tidak ketemu → kolom null + `warnings`, bukan error.
  Isi: project (nama/deskripsi/env), aplikasi (sumber, build, env/buildArgs, domain, mount, job, jadwal backup, limit, preview), database (engine/tag/nama/user, mount, job,
  `password` hanya bila `includeSecrets`), compose (source/template/composeContent/git, serviceDomains, job). Tidak diekspor: webhook token/secret (dibuat baru), riwayat deployment/backup, status.
- `export-project/` `GET /projects/:id/export?includeSecrets=` (`includeSecrets` → owner saja, 403), `import-project/` `POST /projects/import {file, name?}` (throttle 10/menit; `file` `@IsObject`,
  bentuknya divalidasi `validateShape` → 400 untuk format/versi salah). `ProjectImportService.import()`: project baru milik pengimpor; `appName`/`slug` dipakai ulang bila bebas, kalau tidak
  di-slugify ulang (re-impor di instance yang sama); `hostPort` yang sudah dipakai app/DB lain dan domain yang sudah ada dilewati dengan warning; mount bind hanya owner/admin (aturan add-mount);
  job lewat `JobService.build` (cron salah → job dilewati) lalu `JobSchedulerService.reschedule`; DB dibuat `creating` + `provisionInBackground` (password dari file atau baru) setelah mount-nya
  ada, `BackupSchedulerService.reschedule`; app `VolumeBackupSchedulerService.reschedule`. Ketiga scheduler kini di-export module-nya. Membalas `ImportReport {projectId, created{...}, warnings[]}`.
  Spec `project-import.service.spec.ts` (repo in-memory). Belum: impor selektif/merge ke project yang ada, ekspor data (backup) ikut serta, ekspor seluruh instance.

## Backup instance (database panel)

- `src/modules/instance-backup/` — snapshot DB panel **tanpa pg_dump** (API tidak punya binary-nya dan Postgres panel bisa di luar network `aoox`): `database-snapshot.ts`
  `tableOrder(entityMetadatas)` (Kahn atas FK, pure & di-unit-test; siklus → error) → tiap tabel `SELECT row_to_json(t)` → satu JSON `{format:'aoox-instance', version:1,
  migrations[], tables[]}` di-gzip → ditulis ke volume `aoox_backups` `_instance/<stamp>.json.gz` lewat busybox stopped + `putArchive` (`tarFiles` kini menerima Buffer).
  Entity `InstanceBackup` (`instance_backups`: filename, status success|failed, trigger, size, `row_count`, `schema_version` = migrasi terakhir, destination/remoteKey) — row ditulis **setelah**
  dump selesai sehingga snapshot tidak pernah memuat dirinya sebagai "running"; `InstanceBackupSettings` (`instance_backup_settings`, satu row `default`: cron, keep, destinationId).
- Restore (`json_populate_recordset(NULL::"t", $1)` per 500 baris dalam satu transaksi; DELETE urutan terbalik lalu INSERT urutan FK): syarat daftar `migrations` **sama persis** (400 kalau beda —
  restore hanya antar versi yang sama), tabel `migrations` tidak disentuh, row `instance_backups` milik server ini di-merge kembali (`ON CONFLICT DO NOTHING`, dibaca sebagai `row_to_json`
  karena key harus nama kolom). Setelahnya: `reloadAll()` di `JobSchedulerService`/`BackupSchedulerService`/`VolumeBackupSchedulerService` (hapus entri cron miliknya, daftar ulang dari DB),
  `RemoteDockerService.forgetAll()`, dan probe dekripsi satu nilai terenkripsi → warning "ENCRYPTION_KEY berbeda" bila gagal; warning JWT_SECRET selalu disertakan. Container tidak disentuh.
- Flow (semua `@Roles('owner')`): `POST /instance/backups` (sinkron, 201), `GET /instance/backups` (+`local` via `BackupFilesService.annotate`), `POST /instance/backups/:id/restore`
  (`ensureLocal` → tarik dari S3 bila perlu), `POST /instance/restore` (multipart `file`, `SNAPSHOT_MAX_BYTES` 256 MB — jalur server baru), `GET .../download`, `DELETE`,
  `GET/PATCH /instance/backup-settings` (+`InstanceBackupSchedulerService.reschedule`; terjadwal → `prune(keep)` hanya yang scheduled). Gagal → notifikasi `backupFailure`.
  Web: `instance-backup-card.tsx` di Settings → Infrastruktur (owner), proxy unduh `/api/instance-backups/[id]/download`, restore dari file lewat server action multipart.
  Belum: restore selektif per tabel, backup file mount/volume registry ikut serta, restore lintas versi (jalankan migrasi setelah restore).

## Update instance (aoox itu sendiri)

- `src/modules/instance-update/` — cek & terapkan update untuk image `aoox-api`/`aoox-web` milik panel sendiri (bukan aplikasi yang di-deploy user — itu sudah ada
  `ImageDigestService`/`ImageUpdateWatcherService` terpisah). Sebelumnya cuma bisa manual (`docker compose pull && up -d` lewat SSH, didokumentasikan di docs/instalasi).
- **Perbandingan digest, bukan versi/tag**: `remoteDigestFor()` memakai ulang `parseImageRef` (application module) + `fetchRemoteDigest` (registry module, `HEAD /v2/.../manifests/<tag>`)
  yang sudah dipakai `ImageDigestService` untuk auto-update image aplikasi — **selalu Docker Hub** (`hideandseeklab/aoox-api`/`aoox-web` publik, tanpa kredensial), tag dari env
  `API_IMAGE`/`WEB_IMAGE` (default `:latest`, sama dengan `docker-compose.dist.yml`). **Sengaja tidak membandingkan local `docker inspect`/`RepoDigests` dengan digest registry** —
  pelajaran yang sama dengan auto-update aplikasi ("beda representasi bisa memicu loop redeploy"): baseline **selalu** disimpan dari `fetchRemoteDigest()` yang sama dipakai untuk
  cek berikutnya, bukan dicampur dengan nilai dari sumber lain. `InstanceUpdateState` (tabel `instance_update_state`, row tunggal `default`): `apiDigest`/`webDigest`/`checkedAt`.
  **Cek pertama kali** (baseline `null`) tidak bisa tahu apakah versi yang berjalan sudah basi — hanya menyimpan digest saat ini sebagai baseline dan melaporkan `updateAvailable: false`
  (`currentDigest: null` di response, dibedakan dari "sudah terbaru" di UI); jujur soal keterbatasan ini daripada berpura-pura tahu.
- **Apply** (`POST /instance/update/apply`, owner, throttle 3/menit, 202): pola yang sama persis dengan `panel-domain` — butuh `INSTALL_DIR`, fire digest baru + simpan sebagai
  baseline lalu `setTimeout` 1,5 detik supaya response HTTP sempat terkirim sebelum container `web`/`api` di-recreate. Helper `docker:29-cli` (bind `INSTALL_DIR` host langsung +
  docker socket, `runComposeHelper()` di `docker/compose-apply.util.ts` — dipakai bersama `panel-domain` dan `instance-env`) menjalankan `docker compose $FILES --env-file .env.dist
  pull` lalu `up -d`. **Jebakan yang sempat lolos**: dulu dipikir `-f docker-compose.dist.yml` saja cukup karena "override otomatis ter-include" — salah; Compose hanya
  meng-auto-include `docker-compose.override.yml` kalau file utama bernama persis `docker-compose.yml` (default lookup tanpa `-f`), bukan saat `-f docker-compose.dist.yml` disebut
  eksplisit (ditemukan lewat test VPS sungguhan: domain panel hilang lagi setelah `aoox update`). `COMPOSE_FILES_SCRIPT` (util yang sama) membangun `$FILES` dengan `[ -f
  docker-compose.override.yml ] && FILES="$FILES -f docker-compose.override.yml"` — file itu boleh belum ada sama sekali (belum pernah set domain panel). Tidak menyentuh
  `docker-compose.domain.yml` manual (butuh `-f` eksplisit sendiri, di luar cakupan fitur ini).
- `GET /instance/update` (owner) juga membalas `currentVersion` (dibaca dari `package.json` di `process.cwd()` — image runner meng-copy `package.json` ke `/app/`, lihat Dockerfile)
  untuk ditampilkan, bukan dipakai untuk logika pembanding update (channel alpha belum tentu naik linear per tag, digest tetap sumber kebenaran).
- CLI: `aoox update` (cek) / `aoox update --apply` (terapkan). Web: `instance-update-card.tsx` di Settings → Infrastruktur (owner), tombol "Cek update" (server action, bukan cuma
  render awal) dan "Terapkan update" (disabled kalau `INSTALL_DIR` kosong atau tidak ada update).
  Belum: notifikasi (email/webhook) saat ada update tersedia — sinyal versi di bawah hanya untuk badge sidebar/halaman Update —, rollback otomatis kalau `docker compose up` gagal setelah pull.
- **Sinyal "ada versi lebih baru" untuk sidebar** (`instance-version.service.ts`, `semver.ts`, `registry/remote-tags.ts`): sinyal digest di atas tidak cukup — baseline `null` di cek pertama tidak bisa
  tahu versi berjalan sudah basi, dan hanya jalan saat owner menekan tombol. Jadi ada sumber kedua yang **berbasis versi**: `fetchRemoteTags()` (`GET /v2/hideandseeklab/aoox-api/tags/list?n=1000`, alur
  Bearer yang sama dengan `fetchRemoteDigest`) → `newestVersion(tags, currentVersion)` (semver.org 2.0.0 murni: `alpha.9 < alpha.10`, stabil > pre-release dengan inti sama; tag non-semver seperti
  `latest` diabaikan; instalasi **stabil tidak pernah ditawari pre-release**, instalasi pre-release ditawari apa pun yang lebih baru) → disimpan di kolom `latest_version`/`latest_checked_at`
  (`instance_update_state`, migrasi `InstanceUpdateLatestVersion`, additive). Dipicu `@Cron('17 */6 * * *')` (+ jitter acak ≤5 menit) dan sekali ±20–60 detik setelah boot
  (`OnApplicationBootstrap`, `setTimeout(...).unref()`), **tidak pernah** per request; gagal jaringan/registry = `debug` saja, cache lama dipertahankan, `latest_checked_at` hanya untuk sukses
  (instalasi tanpa internet tetap normal tanpa badge). `check()` (`GET /instance/update`, tombol "Cek update") memanggil `refresh()` juga dan mengembalikan blok `version`, jadi halaman dan sidebar
  selalu konsisten. **`updateAvailable` diturunkan saat dibaca** (versi cache lebih baru dari `appVersion()` proses ini), bukan disimpan: badge hilang seketika begitu container baru menyala.
  **Instalasi dengan tag di-pin**: `docker-compose.dist.yml` sekarang meneruskan `API_IMAGE`/`WEB_IMAGE` (default persis sama dengan baris `image:`) ke container api, tapi **instalasi lama** baru
  menerimanya lewat `aoox reinstall` (`aoox update`/"Terapkan update" tidak menulis ulang compose) — sebelum itu env-nya kosong; `tracked()` memakai `API_IMAGE` bila ada,
  kalau tidak `Config.Image` container sendiri (`inspectContainer(os.hostname())`, sekali per proses) → `latest` (badge boleh), `pinned` (tag versi/channel/digest — `pull` tidak akan menggesernya,
  jadi **tanpa badge**, halaman Update hanya menginformasikan versi terbaru) atau `unknown` (daemon tak terjangkau/bukan container — **tanpa badge**, sengaja daripada menyesatkan).
  `GET /auth/me` menambah `updateAvailable: {version, applying}` **hanya untuk `owner`** (`MeService`, dibaca dari cache tanpa panggilan registry; error apa pun → field dihilangkan, `/auth/me` tidak pernah
  rusak karenanya; peran lain bahkan tidak memicu pembacaan cache). `applying` dibatasi 10 menit sejak `applyStartedAt` supaya apply yang gagal tidak mengunci teks "Sedang memperbarui…" selamanya.
  Env `INSTANCE_UPDATE_REGISTRY_URL` mengganti basis URL registry (mirror/uji). Diuji nyata dengan registry palsu + Postgres terpisah: versi lebih tinggi → owner dapat field, admin/member tidak;
  sama/lebih lama → hilang; `alpha.10` > `alpha.9`; registry 500 → tanpa error log, cache dipertahankan. **Belum diuji nyata**: tag `pinned` terhadap container Docker sungguhan (hanya tes unit).
- **Variabel opsional yang diteruskan compose ke api**: `API_IMAGE`, `WEB_IMAGE` (default = `image:`; jangan biarkan keduanya berbeda — ada tes di CLI yang menjaga), `WEBHOOK_VERIFY_GITHUB_IP`
  dan `PREVIEW_DOMAIN` (`${VAR:-}` = kosong = mati/tidak diset; pembacanya memakai `=== 'true'` dan `?.trim() ||`, jadi string kosong aman — beda dari jebakan `??`). Keempatnya tidak ditulis ke
  `.env.dist` baru oleh `aoox install`/`reinstall` (tak ada default bermakna) — hanya contoh terkomentar di `.env.dist.example`.
- **Keterbatasan penting**: `apply()` hanya `docker compose pull && up -d` — **tidak pernah** menulis ulang `docker-compose.dist.yml` di `INSTALL_DIR` host. Jadi perbaikan/fitur baru
  yang butuh baris baru di file compose itu sendiri (var `environment:` baru, service baru, dll — mis. `PUBLIC_API_URL` yang sekarang juga diteruskan ke service `api`, lihat bagian
  Git credential & Webhook) **tidak sampai** ke instalasi yang sudah ada lewat `aoox update` / tombol "Terapkan update" — image baru dijalankan dengan compose file **lama** di host,
  jadi environment baru itu tidak pernah terpasang sampai file compose di host diedit manual. Langkah manual: tambahkan baris yang kurang ke service yang tepat di
  `/opt/aoox/docker-compose.dist.yml` (atau `INSTALL_DIR` lain), lalu `docker compose -f docker-compose.dist.yml -f docker-compose.override.yml --env-file .env.dist up -d`
  (`-f docker-compose.override.yml` hanya kalau file itu ada — dibuat oleh panel-domain/instance-env, lihat bagian Proxy & Domain). Ide yang belum diimplementasikan: `apply()`
  bisa juga menulis ulang `docker-compose.dist.yml` dari salinan yang dibundel di image `api` sendiri (image sudah membawa versi baru file itu untuk keperluan lain) sebelum
  `up -d`, supaya update compose ikut ter-apply otomatis — belum dikerjakan, perlu hati-hati karena bisa menimpa modifikasi manual operator di file itu (mis. `docker-compose.build.yml`
  override lokal, atau baris yang sengaja ditambah operator sendiri).
- **Perbaikan instalasi lama**: `aoox reinstall` di `../aoox-cli` menutup keterbatasan di atas — menulis ulang `docker-compose.dist.yml` (+ `docker-compose.domain.yml` bila ada) dari salinan
  bundel CLI, **menggabung** `.env.dist` (nilai/urutan/komentar dipertahankan, hanya key hilang yang punya default aman ditambah, mis. `TERMINAL_SSH_USER=root`; secret tidak pernah dibuat
  ulang, berhenti bila `POSTGRES_PASSWORD`/`JWT_SECRET`/`ENCRYPTION_KEY` hilang), backup ke `<dir>/backups/<waktu>/`, lalu `pull` + `up -d --force-recreate` dengan daftar `-f` yang
  sama dengan stack berjalan (label `com.docker.compose.project.config_files` container api). `docker-compose.override.yml` (milik panel-domain/instance-env) tidak disentuh. Rekomendasikan ini
  — **bukan** `aoox install --force` (secret baru) — untuk instalasi yang ketinggalan compose/env. Karena default key diturunkan dari `buildEnvFile` + `${VAR}` di compose bundel,
  perubahan compose/env baru di sini tetap harus disalin ke `aoox-cli/assets/install/` (lihat bagian Docker / distribusi).

## Environment instance (`.env.dist` sebagian, dari dashboard)

- `src/modules/instance-env/` — subset **whitelist** env var yang bisa diubah owner dari dashboard tanpa SSH: `TERMINAL_SSH_HOST/PORT/USER/PASSWORD`, `PUBLIC_IP`,
  `REGISTRY_PUBLIC_HOST`. Pola sama persis dengan `panel-domain`/`instance-update` (butuh `INSTALL_DIR`, helper `docker:29-cli` via `runComposeHelper()`,
  `setTimeout` 1,5 detik karena mengganti env ini me-recreate container `api` — satu-satunya service yang mendeklarasikan var-var ini di `docker-compose.dist.yml`).
  **Sengaja whitelist, bukan editor bebas**: menambah field di sini tanpa juga menambahkannya ke `environment:` service `api` di `docker-compose.dist.yml` tidak akan
  pernah berlaku (Compose hanya meneruskan var yang memang dideklarasikan di sana, meski `.env.dist` punya baris lain) — jangan buat field baru tanpa mengecek itu dulu.
  Var seperti `JWT_SECRET`/`ENCRYPTION_KEY`/`POSTGRES_PASSWORD` **tidak pernah** masuk whitelist ini (mengubahnya lewat form biasa berisiko: invalidasi semua sesi,
  gagal dekripsi kredensial tersimpan, dll — tetap harus manual dengan kesadaran penuh).
- `GET /instance/env` (owner) membalas nilai aktif sekarang (`ConfigService.get()`, sama seperti `panel-domain.status()` membaca `WEB_ORIGIN`) — bukan isi file `.env.dist`
  yang belum diterapkan. `terminalSshPassword` **tidak pernah** dikembalikan (hanya `terminalSshPasswordSet: boolean`), pola yang sama dengan notifikasi/webhook DTO yang
  tidak pernah membawa rahasia di endpoint list/status.
- `GET /instance/env` juga membalas `terminalSshUserDefault` (`root`, dari konstanta yang sama dengan backend terminal): `terminalSshUser` tetap **nilai mentah** (null bila kosong)
  supaya form tidak menyimpan `root` yang tak pernah diketik user; web menampilkan `root (default)` sebagai placeholder + catatan selagi kosong.
- `PATCH /instance/env` (owner, throttle 5/menit, 202): tiap field independen — field yang di-omit dibiarkan, string kosong **menghapus** nilai (kembali ke default
  `${VAR:-default}` di compose, mis. `REGISTRY_PUBLIC_HOST=` kosong → balik ke `localhost`). Hanya key yang benar-benar dikirim yang di-upsert ke `.env.dist`
  (`envUpsertLine()`), jadi menyimpan bagian "SSH Terminal" saja tidak menyentuh `PUBLIC_IP`/`REGISTRY_PUBLIC_HOST`. Web: `instance-env-card.tsx` di Settings → Infrastruktur
  → **Environment** (owner), dua bagian (SSH Terminal, Jaringan) dengan tombol simpan terpisah agar tidak perlu isi semua sekaligus.
  Belum: whitelist var lain yang sering ditanyakan (mis. `METRICS_RETENTION_DAYS`, `DISK_ALERT_PERCENT` — belum ada di `docker-compose.dist.yml` sama sekali, perlu
  ditambahkan ke compose dulu sebelum bisa masuk whitelist ini), validasi bahwa `TERMINAL_SSH_HOST` benar-benar bisa dijangkau sebelum disimpan.
- `docker/compose-apply.util.ts` (dipakai `panel-domain`, `instance-update`, `instance-env`): `envUpsertLine()` (pure, di-unit-test) dan `runComposeHelper()`
  (buat container `docker:29-cli`, bind `installDir` + socket docker, opsional tulis file lewat `putArchive`, start, wait, hapus) — sebelumnya disalin manual di dua
  tempat (dan nyaris di tempat ketiga ini), sekarang satu sumber kebenaran untuk pola "edit `.env.dist`/compose lalu `docker compose up` dari dalam container sendiri".

## Docker Swarm (tahap 1–2: single node, app sebagai service)

- `src/modules/swarm/` — `SwarmService` di atas Engine API (`GET /swarm`, `POST /swarm/init|leave`, `GET/POST/DELETE /nodes`, klien: `inspectSwarm/initSwarm/leaveSwarm/listNodes/
  inspectNode/updateNode/removeNode`, service: `createService/inspectService/updateService(version!)/removeService/listTasks/serviceLogs/followServiceLogs`, `connectNetwork`,
  `createOverlayNetwork`; tipe `SwarmNode/ServiceSpec/ServiceInspect/SwarmTask`). Flow (`/swarm`): `swarm-status` (owner/admin; join token hanya owner), `init-swarm` (owner; daemon
  `error` — sertifikat kedaluwarsa — di-`leave --force` dulu), `leave-swarm` (409 selama masih ada app `deployMode='service'`), `update-node` (drain/aktif, promote), `remove-node`.
  Modul mengimpor **entity** `Application` saja (bukan ApplicationModule — runner mengimpor SwarmModule, arah sebaliknya siklus) + ProxyModule.
- **Network**: service tidak bisa masuk bridge `aoox` → overlay attachable **`aoox-swarm`** (`SWARM_NETWORK` di proxy.service) dibuat saat init; container proxy & managed DB
  yang berjalan di-`connect` ke sana (`ensureNetwork`, juga dipanggil tiap deploy service) supaya Traefik menjangkau task dan app menjangkau DB by name; proxy & managed DB yang
  dibuat sesudahnya di-connect saat provision (`SwarmService.connectIfActive`, no-op tanpa swarm; ManagedDatabaseModule mengimpor SwarmModule). Diuji: task service membuka
  `${{database.<slug>.url}}` lewat nama container. `leave` menghapus overlay-nya sendiri (network swarm-scope hilang bersama swarm) dan mem-provision ulang proxy tanpa flag swarm.
- **Traefik**: v3 punya provider terpisah — `provisionOn` menambahkan `--providers.swarm=true|exposedbydefault=false|network=aoox-swarm|refreshSeconds=3` bila daemon manager
  (provider swarm **polling**, bukan event; 15 s default membuat task lama masih dirutekan sesaat → 3 s). Init/leave swarm mem-provision ulang proxy bila terpasang. Label Traefik dibaca dari
  **service** (`Labels`), label `aoox.*`/compose dari **task container** (`ContainerSpec.Labels`) untuk monitoring/events — `serviceSpecFor` menaruh keduanya.
- **App sebagai service** (`Application.deployMode` `container`|`service`, `replicas` 1–20; DTO create/update, hanya host — `serverId` + service = 400; swarm nonaktif = 400):
  `service-spec.ts` `serviceSpecFor()` (pure, di-unit-test): env/healthcheck/mounts (`mountFromBind` dari string `bindsFor`)/limit (`Resources.Limits`)/network/LogDriver/
  `EndpointSpec.Ports` `PublishMode: host` untuk `hostPort`/`UpdateConfig` `Parallelism 1, FailureAction rollback, Order start-first` (stop-first bila ada host port). Runner
  `replaceContainer` bercabang: service → `SwarmDeployService.deploy(app, spec, auth, log)` (hapus container legacy `<name>`/`-next`, create atau `update?version=`, `waitConverged`
  = poll `UpdateStatus` (`completed`/`rollback_*`/`paused`) + task `running`/failed ≥3; create gagal → service dihapus); container → service lama dihapus dulu.
  Update selalu mem-bump `TaskTemplate.ForceUpdate` (spec identik — tag sama di-pull ulang — tetap me-roll task, seperti container mode selalu recreate) dan update "milik kita"
  dikenali dari `UpdateStatus.StartedAt` yang **berbeda** dari sebelum panggilan, bukan perbandingan jam daemon vs API (diuji: 3 deploy identik berturut-turut sukses ±15 s).
  Replika > 1 dengan mount `volume` = semua task memakai volume yang sama di node ini (keadaan tetap, bukan hanya saat swap).
  `X-Registry-Auth` (`registryAuthFor`) untuk registry lokal/registry image privat. Ganti mode/replika di `update-application` → `applyRuntimeConfig` (deploy ulang image terakhir).
- Jalur lain: get-application `service` (`SwarmDeployService.status`: desired/running/tasks) + `container` diturunkan dari task; stop/start = `scale(0)`/`scale(replicas)`;
  delete = `removeService`; logs & gateway = `serviceLogs`/`followServiceLogs` (semua task); metrics & job exec = task running terbaru (`taskContainers`); restore volume backup = scale 0/kembali;
  `container-down-notifier`: task swarm hanya dilaporkan bila `running < desired` ("task crashed (1/2 replicas)"), rolling update tidak memicu. Diuji: 2 replika via Traefik,
  rolling update 119/120 request 200, stop/start, exec job, kill task → replaced + notifikasi, ganti mode bolak-balik, hapus.
- **Tahap 3 (multi-node)**: `Application.swarmNodeId` (nullable; DTO create/update `@Matches` id node) → `Placement.Constraints` `node.id==…` (`serviceSpecFor.constraints`);
  app **dengan mount** selalu dipin ke node host (`placementFor`: volume/file mount hanya ada di daemon ini), ganti node → `applyRuntimeConfig`. `ServiceStatus.tasks[]` membawa
  `nodeId`/`node` (hostname dari `listNodes`)/`local`; `taskContainers()` hanya task **di node ini** (`SwarmService.localNodeId`) karena Engine API tidak punya exec/stats lintas node —
  job `target: container` di app yang task-nya semua di node lain → error jelas (pakai `run` atau pin ke host), metrik `null`; log service tetap lintas node.
  `SwarmStatus.registry` `{url, reachableFromNodes}`: URL registry `localhost:` tidak bisa di-pull node lain → kartu web menampilkan peringatan (set `REGISTRY_PUBLIC_HOST` + `insecure-registries`/TLS,
  provision ulang registry); image publik tidak terpengaruh. Diuji dengan worker `docker:27-dind` yang join swarm Docker Desktop: task terjadwal di worker (pin) / di host (mount),
  log lintas node, pesan exec. **Belum bisa diuji di sini**: lalu lintas overlay VXLAN antara VM Docker Desktop dan dind (kontrol plane jalan, data plane timeout dua arah — batasan lingkungan,
  butuh mesin kedua sungguhan); di mesin nyata Traefik → task di node lain memakai jalur yang sama dengan single-node. Belum: metrik gabungan antar task, DB/compose/preview sebagai service,
  `docker stack deploy`, constraint selain `node.id`.
- **Observability service**: metrik app service = **jumlah semua task lokal** (`aggregateMetrics()` di `container-metrics.ts`, pure & di-unit-test: `current` = jumlah sampel terakhir,
  `history` di-bucket per tick sampler 15 s; respons `tasks` = jumlah task yang dijumlahkan). `service-health-watcher.service.ts` (`@Cron('*/2 * * * *')`): app service `running` yang
  `running < desired` di **dua tick berturut-turut** → notifikasi `containerDown` "Service short of replicas" (+ task pending & error-nya), cooldown 30 menit — melengkapi container-down-notifier
  yang buta terhadap task yang tidak pernah start (unschedulable, image tak bisa di-pull). Perubahan mode/replika/node/limit app service = **deployment `kind: 'config'`**
  (`DeploymentRunnerService.queueRuntimeConfig`, jalur rollback tanpa build; 409 bila ada deployment lain) — bukan sinkron, karena rolling update bisa bermenit-menit. Update start-first yang
  task barunya tak pernah jalan (constraint mustahil, image tak ada) tidak pernah gagal sendiri → `waitConverged` timeout → `engine.rollbackService(id, version, spec)`
  (`?rollback=previous`, body harus spec valid meski diabaikan; body kosong = socket hang up) → daemon memulihkan `PreviousSpec`; `statusAfterFailure` menjaga `status: 'running'`
  bila task lama masih melayani. Diuji: node bogus → deployment `failed`, service `rollback_completed`, app tetap 2/2 running; `docker service update --replicas 3` + constraint mustahil →
  notifikasi short. Rollback ke deployment lama sudah cukup memakai flow rollback biasa (update service dengan image lama).
- **Label node & constraint**: `PATCH /swarm/nodes/:id {labels}` mengganti seluruh set label node (key `[A-Za-z0-9_.-]`, nilai `[A-Za-z0-9_.:/-]`; tampil di `SwarmNodeInfo.labels`).
  `Application.swarmConstraint` (regex `SWARM_CONSTRAINT`: `node.(id|hostname|role|platform.os|arch|labels.<k>)(==|!=)<v>`) digabung dengan `swarmNodeId`/pin host di `placementFor`
  (semua constraint harus terpenuhi). **Parameter rolling update** per app: `updateParallelism` (1–20), `updateDelaySeconds` (0–600), `updateOrder` `auto|start-first|stop-first`
  (`serviceSpecFor.update`; start-first **tidak dihormati** bila ada host port). Perubahan keduanya di update-application = deployment `config`. Web: field "Constraint tambahan",
  "Rolling update" (task/batch + jeda) dan "Urutan" di form saat mode service; editor label inline per node di kartu Swarm (owner).
