# License issuer settings

These settings turn this app into a license issuer. They are for the vendor's issuer environment only.

| Setting | Value | Secret |
| --- | --- | --- |
| `LICENSE_ISSUER_ENABLED` | `true` | No |
| `LICENSE_SIGNING_KEY_ID` | `dev-3` | No |
| `LICENSE_TRUSTED_PUBLIC_KEYS` | See below | No (public) |
| `LICENSE_SIGNING_PRIVATE_KEY` | Stored in project environment settings | Yes |
| `LICENSES_PIN` | Stored in project environment settings | Yes |

Trusted public key map:

```json
{"dev-3":"-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAXDSkPGSKGmMGFIIpS5U2kF2dOx0hVZE68OZUX8kITLY=\n-----END PUBLIC KEY-----"}
```

Never commit the private key or the PIN to this repository.

Issue a license from an activation request:

```bash
npx tsx scripts/issue-license.ts <activation-request.json> [output.json] [supersedes-license-id]
```
