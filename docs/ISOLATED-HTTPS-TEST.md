# Isolated HTTPS browser verification - operating procedure

**STATUS: NOT APPROVED, NOT RUN.** Nothing in this document has been executed.
No certificate has been installed, no server started, no firewall rule changed,
no live service restarted, and nothing committed or pushed.

This covers one test only. The **agreed setup** is fixed and is not revisited by
any step below:

| Component | Value |
| --- | --- |
| Test frontend (HTTPS) | **5174** |
| API proxy target | **127.0.0.1:8100** |
| Isolated MongoDB | **127.0.0.1:27019** |
| Test database | `university_attendance_e2e_test` |
| Test CA store (`CAROOT`) | `.e2e\tls\ca` (dedicated) |
| Geofence radius / slack | **150 m / 0 m** |
| `requiredAttendanceMinutes` | **2** |
| Location testing | **blocked until the operator confirms the venue** |

Backend 8100 and MongoDB 27019 stay bound to **loopback only** and are never
exposed. The live application (27017 / 8000 / 5173) is never touched.

### The five separate activities

These are deliberately independent, and each needs its own approval. Do not
combine them.

| # | Activity | Section | Changes machine state? |
| --- | --- | --- | --- |
| A | Read-only pre-flight checks | 1 | No |
| B | Transfer the public CA to the phone | 2 | Briefly, and only if HTTP is used |
| C | Install the CA (PC and iPhone) | 3 | Yes - trust store |
| D | Start the HTTPS test frontend and verify login | 4 | No |
| E | Firewall scoping for LAN access | 5 | Yes - shared system rules |

Phases A, C and D are unrelated to E. E is only needed for real iPhone testing
over the LAN, and is the one phase most likely to affect other software.

## 1. Phase A - read-only pre-flight (no approval needed)

Run from the repository root. None of these commands changes anything.

```powershell
# A1. mkcert trust inventory. MUST be re-checked on the day of the run.
Get-Command mkcert -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
Write-Output "CAROOT=[$env:CAROOT]"
@(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -match 'mkcert' }).Count
@(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -match 'mkcert' }).Count
```

Last recorded on 2026-10-03: mkcert **not on PATH**, `CAROOT` **unset**, **0**
mkcert certificates in either root store, and `%LOCALAPPDATA%\share\ca`
**absent**. So there was no existing mkcert trust.

> If A1 later reports a non-zero count, **stop**. That CA belongs to another
> project. Do not reuse it and do not remove it - see section 6.

```powershell
# A2. This machine's LAN address and subnet (recorded: 192.168.1.101 / 24).
Get-NetIPConfiguration -InterfaceAlias 'Wi-Fi' |
  Select-Object InterfaceAlias, @{n='IP';e={$_.IPv4Address.IPAddress}},
                    @{n='Prefix';e={$_.IPv4Address.PrefixLength}}
Get-NetConnectionProfile | Select-Object InterfaceAlias, NetworkCategory
```

Last recorded: **192.168.1.101/24**, network category **Public**.

```powershell
# A3. Confirm the live stack is on loopback and the test ports are free.
Get-NetTCPConnection -State Listen -LocalPort 8000,5173,27017,5174,8100,27019
```

Last recorded: `127.0.0.1:8000`, `::1:5173`, `127.0.0.1:27017` live; **5174,
8100 and 27019 free**.

## 2. Phase B - transferring the public CA certificate to the iPhone

### 2.1 What is transferred, and what never is

**Only** the single public file `rootCA.pem` is transferred.

Never transferred, and never served from any web server:

- the **CA private key** (`ca-key.pem`) - whoever holds it can mint a
  certificate the phone trusts;
- `localhost-key.pem`, the certificate private key;
- `CAROOT` itself, the repository, or any parent directory;
- `.env` files, `backend/backups/`, `.e2e\mongo-data/`, `node_modules/`.

Serving a directory that merely *contains* these is as bad as serving them, so
the transfer folder below holds exactly one file and nothing else.

### 2.2 Preferred method - an existing trusted transfer channel

Transfer `rootCA.pem` to the iPhone by **AirDrop, email, or USB cable**, and
skip 2.3 entirely. This needs no server, no port and no firewall change, and is
the recommended route.

### 2.3 Fallback only - short-lived HTTP transfer of the one public file

Only if 2.2 is not possible.

**Port 9443** is used. It was verified free on 2026-10-03 and is deliberately
**not 8000** - 8000 is the live backend's port and must never be bound for this -
and not 5174, which belongs to the test frontend.

```powershell
# B1. Transfer folder holding ONLY the public CA certificate.
$transfer = "c:\xampp\htdocs\University-Attendance-App\.e2e\tls\ca-transfer"
Remove-Item $transfer -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $transfer | Out-Null
Copy-Item "c:\xampp\htdocs\University-Attendance-App\.e2e\tls\ca\rootCA.pem" $transfer

# B2. PROVE the folder holds exactly one file and no private key.
Get-ChildItem $transfer -Recurse | Select-Object FullName
```

Stop here if the listing shows anything other than `rootCA.pem`. That check is
the entire safety property of this method.

```powershell
# B3. Serve it on 9443, and STOP the server as soon as the file is saved.
cd $transfer
python -m http.server 9443 --bind 0.0.0.0
```

Access is restricted while it runs: it is only useful from `192.168.1.0/24`,
section 5 scopes the firewall to exactly that subnet for this port, and it runs
for the seconds needed to save one file before being stopped with **Ctrl+C** and
deleted in B4.

```powershell
# B4. Stop (Ctrl+C in the B3 window first), then delete.
Remove-Item $transfer -Recurse -Force
```

### 2.4 Verify the fingerprint before installing anything

Compare the SHA-256 fingerprint over a **different channel** than the one used to
move the file - a phone call, or reading it aloud. Checking a file against a
fingerprint taken from that same file proves nothing.

```powershell
# On the PC, BEFORE transfer:
& 'C:\Program Files\Git\usr\bin\openssl.exe' x509 -in `
  .e2e\tls\ca\rootCA.pem -noout -fingerprint -sha256
```

Record that value, then confirm the value the iPhone shows at **Settings >
General > About > Certificate Trust Settings** (tap the certificate name). **If
they differ, do not install it.**

## 3. Phase C - installing the certificate (needs approval)

This is the only phase that writes to a trust store.

### 3.1 Dedicated CA store

`CAROOT` is set to this project's own directory, never the shared default, so
this CA's files cannot collide with - or be removed alongside - another
project's.

```powershell
$env:CAROOT = "c:\xampp\htdocs\University-Attendance-App\.e2e\tls\ca"
New-Item -ItemType Directory -Force -Path $env:CAROOT | Out-Null
winget install --id FiloSottile.mkcert -e
```

`CAROOT` must be set in the **same** shell as every `mkcert` command below.
mkcert reads it from the environment, and a different shell would silently use
the shared default instead - which is exactly what this procedure avoids.

### 3.2 PC installation

```powershell
mkcert -install
```

This adds **only this CA** to `Cert:\CurrentUser\Root` and prompts for
administrator consent. Then create the certificate, including the LAN address
the phone will use:

```powershell
mkcert -cert-file .e2e\tls\localhost.pem -key-file .e2e\tls\localhost-key.pem `
       localhost 127.0.0.1 192.168.1.101
```

Re-run A2 first: `192.168.1.101` was this machine's Wi-Fi address on 2026-10-03
and changes when the network changes. A certificate without the current address
will not be trusted by the phone.

## 4. Phase D - start the test frontend and verify login

No certificate or firewall change happens here; it only consumes Phase C.

### 4.1 Start the isolated stack

```powershell
$env:TRUSTED_ORIGINS = "https://localhost:5174,https://127.0.0.1:5174"
$env:SECURE_COOKIES = "true"
powershell -ExecutionPolicy Bypass -File .\start-e2e.ps1
```

This starts MongoDB on **127.0.0.1:27019** and the API on **127.0.0.1:8100**, both
loopback only, with radius 150 m, slack 0 m and `requiredAttendanceMinutes` 2.

### 4.2 Start the HTTPS test frontend

```powershell
cd frontend
npx vite --config vite.test.config.ts
```

Serves on **5174** and proxies `/api` to **127.0.0.1:8100**. The config loads the
certificate with `readFileSync`, and refuses to start if either file is missing
or is not real PEM data.

`vite.test.config.ts` binds **127.0.0.1** by default. That keeps it off the LAN
and needs no firewall change.

### 4.3 Verify the login session

```powershell
cd ..
node backend\scripts\verify-https-frontend.mjs
```

This keeps certificate verification **on** and checks a real password login, the
session cookie (`Secure` and `HttpOnly` asserted), authenticated requests, a
refresh and a logout.

`curl -k` is **not** a substitute, and this is measured, not asserted. On
2026-10-03, against an untrusted certificate on this machine:

| Command | Result |
| --- | --- |
| `curl https://127.0.0.1:5199/` | `curl: (60) SEC_E_UNTRUSTED_ROOT` - **fails** |
| `curl -k https://127.0.0.1:5199/` | `http_code=200` - **succeeds** |

So `-k` returns 200 against a certificate nothing trusts. It proves a socket
opened; it cannot prove trust, and it sends no cookies, so it cannot show that a
## 5. Phase E - network exposure, decided separately

**Not needed for phases A-D.** Phase D binds 127.0.0.1 and works with no firewall
change at all. This phase exists only for testing from a **real phone over the
LAN**, and is the phase that touches shared system state.

### 5.1 Current profile and the rules that actually apply

Recorded 2026-10-03, read-only.

| Profile | Firewall | Default inbound policy |
| --- | --- | --- |
| Domain | ON | BlockInbound,AllowOutbound |
| Private | ON | BlockInbound,AllowOutbound |
| **Public (active, Wi-Fi)** | ON | BlockInbound,AllowOutbound |

A targeted scan of every enabled inbound rule for ports **5174**, **8100**,
**27019** and **9443** returned **no dedicated rule for any of them**.

However, 24 rules are fully broad (`Program=Any`, `LocalPort=Any`,
`RemoteAddress=Any`, `Protocol=Any`), and **9 of those apply to the Public
profile**:

| Rule | Program | Port | Remote | Edge |
| --- | --- | --- | --- | --- |
| Desktop App Web Viewer | Any | Any | Any | Allow |
| Game Bar | Any | Any | Any | Allow |
| Microsoft 365 Copilot | Any | Any | Any | Allow |
| Microsoft Store | Any | Any | Any | Allow |
| Microsoft Teams | Any | Any | Any | Allow |
| Dropbox promotion | Any | Any | Any | Allow |
| Windows Feature Experience Pack (x2) | Any | Any | Any | Allow |
| Xbox Gaming Overlay (Game Bar) | Any | Any | Any | Allow |

### 5.2 The honest conclusion

**Adding a narrow allow rule does NOT override these.** Windows Firewall allows a
connection if **any** matching allow rule permits it. Those nine already permit
inbound TCP to **any** listening port from **any** remote address, so a new rule
scoped to `192.168.1.0/24` on port 5174 would grant nothing that is not already
granted to the whole network.

So this document makes **no claim that the test frontend is LAN-only** while
those rules stand. A genuine restriction requires one of:

- **(a)** disabling or narrowing the 9 broad Public-profile rules, or
- **(b)** switching the Wi-Fi profile to **Private** - which does not help on its
  own, since those rules also cover Domain and Private.

**Do not disable all nine automatically.** They belong to other applications
(Microsoft Store, Teams, Dropbox, Xbox) and disabling them may break unrelated
software. This document therefore proposes **no change to any existing rule**,
and asks for a separate decision instead.

### 5.3 Minimum necessary change, if LAN access is required

The narrowest option that adds an allow rule and **modifies nothing existing**:

```powershell
# Allow the phone on the local subnet to reach ONLY the test frontend.
# Creates a new rule; changes no existing rule, so there is nothing to roll back.
New-NetFirewallRule -DisplayName "E2E test frontend 5174 (temporary)" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5174 `
  -RemoteAddress 192.168.1.0/24 -Profile Public -Enabled True
```

**Be clear about what this does and does not achieve.** Because of 5.2 it is
**not** a restriction - the nine broad rules already allow more. It records
intent, and it becomes the rule that actually matters if the broad rules are ever
narrowed later.

An **effective** restriction requires changing the nine existing rules, which
needs its own approval and a recorded rollback (5.4).

### 5.4 Rollback for any pre-existing rule that is changed

Any existing rule modified under approval must be captured **before** the change:

```powershell
# BEFORE changing anything, record the original settings:
$rule = Get-NetFirewallRule -DisplayName "<rule name>"
$rule | Select-Object DisplayName, Enabled, Profile, Direction, Action,
        EdgeTraversalPolicy, Description | Format-List
$rule | Get-NetFirewallPortFilter        | Format-List
## 6. Phase F - cleanup (needs approval)

Nothing below deletes a **shared** directory, a trust entry that may belong to
another project, or any database.

### 6.1 Processes

```powershell
# Stop the test frontend, the isolated API and the isolated MongoDB.
# Use the windows opened in Phase D; do NOT kill by process name, which could
# take the LIVE node.exe or mongod.exe with them.
Get-NetTCPConnection -State Listen -LocalPort 5174,8100,27019 |
  Select-Object LocalPort, OwningProcess   # confirm which, then stop in-window
```

### 6.2 Firewall

```powershell
# Remove only the temporary rule created in 5.3, if it was created.
Get-NetFirewallRule -DisplayName "E2E test frontend 5174 (temporary)" |
  Remove-NetFirewallRule

# Confirm the rule count returns to the pre-test value (recorded: 216).
(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True).Count
```

Any **pre-existing** rule changed under approval is restored from the 5.4 record.

### 6.3 Certificate trust

Remove **only** this project's CA, matched by thumbprint after review:

```powershell
$ca = Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -match 'mkcert' }
$ca | ForEach-Object { Write-Output "would remove: $($_.Subject) [$($_.Thumbprint)]" }
# READ THE LIST. Confirm every entry belongs to THIS project, then:
$ca | Remove-Item
```

**Never run `mkcert -uninstall`** - it removes whatever is in `CAROOT`, which may
not be this project's. **Never delete `%LOCALAPPDATA%\share\ca`** - it is not
ours and may hold another project's CA.

### 6.4 Files

```powershell
# Remove only this project's TLS material. `.e2e/` is entirely this project's
# scratch space and is already gitignored.
Remove-Item -Recurse -Force c:\xampp\htdocs\University-Attendance-App\.e2e\tls
```

**Do not delete** `backend/backups/`, `.e2e/mongo-data/`, any `.env` file, or any
database.

### 6.5 iPhone

1. **Settings > General > VPN & Device Management** - select the mkcert profile -
   **Remove**.
2. **Settings > General > About > Certificate Trust Settings** - switch the mkcert
   root **off**.
3. Delete any leftover profile under **Settings > General > Profiles & Device
   Management**.

### 6.6 Final verification

```powershell
@(Get-ChildItem Cert:\CurrentUser\Root | Where-Object { $_.Subject -match 'mkcert' }).Count
(Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True).Count
Get-NetTCPConnection -State Listen -LocalPort 8000,5173,27017
git -C c:\xampp\htdocs\University-Attendance-App --no-pager status --short
```

Expect: 0 mkcert certificates, the rule count back to **216**, the live stack
still listening on **8000 / 5173 / 27017**, and no unexpected tracked-file
changes.

## 7. Invariants preserved throughout

- Geofence radius **150 m**, slack **0 m** (150 means exactly 150).
- `requiredAttendanceMinutes` = **2**.
- One-shot location age **120 s**; tracking freshness **30 s** as a separate,
  stricter rule (`ATTENDANCE_MAX_OBSERVATION_AGE_SECONDS`).
- Isolated data only: `university_attendance_e2e_test` on **127.0.0.1:27019**.
- API **8100** and MongoDB **27019** stay on **loopback**; never exposed.
- Dedicated `CAROOT`; no other project's CA reused or removed.
- **No location testing until the operator confirms the venue.**
- No live data or configuration changes, no commits, no pushes.

$rule | Get-NetFirewallAddressFilter     | Format-List
$rule | Get-NetFirewallApplicationFilter | Format-List
```

Re-apply those exact values to restore. Nothing has been changed on this
machine, so no rule currently needs restoring.

login session works.
