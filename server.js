'use strict';

// The original Cliproom server remains usable on its own. This entry point
// enables the suite launcher and the static browser-based rooms.
process.env.ROOMSUITE_MODE = '1';
require('./cliproom/server').start().catch(error => { console.error(error); process.exitCode = 1; });
