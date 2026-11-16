# Security lab test matrix

| Test | Procedure | Expected result | Proves? |
|---|---|---|---|
| AUTH-01 | GET /api/lesson/demo-video before login | 401 | Unauthenticated access rejected |
| AUTH-02 | Log in as student; play sample | 200/206 and sample video | Authorized stream accessible |
| AUTH-03 | Log out; request sample again | 401 | Cookie session invalidated |
| CAPTURE-01 | Take OS screenshot while lesson visible | May capture normal pixels | Screenshot blocking **not implemented and not guaranteed** |
| CAPTURE-02 | Start permission-based tab recording | Preview may include the lesson | Site does not block captures; no media uploads |
| CAPTURE-03 | Try independent OS recorder | Site may not see any event | Recording cannot be reliably detected |
| UI-01 | Switch to other window | Black cover appears when blur option is on | Obscures on loss of focus **only** |
| EXT-01 | Enable some browser extension | Site cannot enumerate it | All-extension detection **not possible** |
| EME-01 | Click EME check | Reports candidates or unavailable | Does **not** mean DRM is active |
| DOWNLOAD-01 | Authenticated user visits direct video link | Browser may expose/download MP4 | No DRM; download prevention **not implemented** |

**Document an actual test**: browser + version, operating system, test ID, outcome, screenshot evidence (without private information), and notes.
