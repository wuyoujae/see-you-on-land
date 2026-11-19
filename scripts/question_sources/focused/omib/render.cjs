// SPDX-License-Identifier: GPL-3.0-only
// Render the locally supplied, reviewed SVGs. No upstream script is executed.
const fs = require('node:fs');
const path = require('node:path');
let sharp;
try { sharp = require('sharp'); }
catch (error) {
  if (!process.env.OMIB_SHARP_PATH) throw new Error('Install sharp or set OMIB_SHARP_PATH to its module path.', {cause:error});
  sharp = require(process.env.OMIB_SHARP_PATH);
}
const base=__dirname;
const manifest=JSON.parse(fs.readFileSync(path.join(base,'render-manifest.json'),'utf8'));
(async()=>{
  for(const job of manifest){
    const input=path.join(base,'adapted-svg',path.basename(job.input));
    const output=path.join(base,'assets/images/question-bank/focused',path.basename(job.output));
    await sharp(input,{density:144}).resize(job.width,job.height).flatten({background:'#fff'}).png().toFile(output);
  }
  console.log(JSON.stringify({rendered:manifest.length}));
})();
