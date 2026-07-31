const fs = require('fs');
const content = fs.readFileSync('dist/assets/index-DsEpAozb.js', 'utf8');
console.log(content.includes('generativelanguage.googleapis.com'));
