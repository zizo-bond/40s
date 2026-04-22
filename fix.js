const fs = require('fs');
const index = fs.readFileSync('index.html', 'utf8');
const data = fs.readFileSync('termsData.js', 'utf8');
const newIndex = index.replace('<script src="termsData.js"></script>', '<script>\n' + data + '\n</script>');
fs.writeFileSync('index.html', newIndex);
