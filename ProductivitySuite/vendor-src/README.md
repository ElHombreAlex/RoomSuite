# Office conversion browser libraries

RoomSuite serves the published browser distributions in `../vendor/` locally. They are loaded only when an Office file is imported or exported. The application does not install or execute this directory's Node dependencies at runtime.

To refresh the checked-in files, run `npm ci --ignore-scripts` in this directory, then `node sync.cjs`. The lockfile pins package versions and `sync.cjs` copies the published browser distributions and collects license notices. The build-only dependency overrides avoid known issues in transitive Node packages; the published PptxGenJS browser bundle excludes its Node-only `image-size` dependency. ExcelJS's published browser bundle contains its original UUID dependency, but ExcelJS invokes only UUID v4; the affected v3/v5/v6 buffer APIs are not exposed by RoomSuite. Revisit the upstream distributions when updating these libraries.
