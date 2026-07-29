---
paths:
  - "services/hwpx-engine/**"
  - "third_party/rhwp/**"
  - "tests/hwpx/**"
---
# HWPX Rules

- `third_party/rhwp` contains pristine imported upstream source plus provenance records.
- Prefer UNE adapter code outside third_party. Direct changes require a Patch ID and patch manifest.
- Preserve unknown XML parts and unsupported objects unless the compatibility policy says REJECT.
- Every save runs package, XML, reference, semantic, style, and rhwp reopen validation.
- Never make Hancom desktop automation part of the online save request.
- Add fixture and round-trip evidence for every serializer or numbering change.
