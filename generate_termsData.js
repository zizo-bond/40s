const fs = require('fs');
const path = require('path');

// قراءة البيانات المستخرجة
const extractedData = JSON.parse(fs.readFileSync('extracted_40s_terms.json', 'utf8'));

// إنشاء محتوى termsData.js
const jsContent = `const originalTerms = ${JSON.stringify(extractedData, null, 4)};
`;

// كتابة الملف
fs.writeFileSync('termsData.js', jsContent, 'utf8');

console.log(`✅ تم إنشاء termsData.js بـ ${extractedData.length} كلمة`);
