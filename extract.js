const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');

const BASE_API = 'https://ar.wikisource.org/w/api.php';
// فترة الأربعينيات (1940-1950) تقابل تقريباً الأعداد من 339 إلى 900
const START_ISSUE = 339; 
const END_ISSUE = 900; 

// إضافة ترويسة User-Agent لتجنب حجب البوت من ويكي مصدر (خطأ 403)
const AXIOS_CONFIG = {
    headers: { 'User-Agent': 'ResalaMagazineExtractor/1.0 (Arabic dictionary bot)' }
};

const delay = (ms) => sleep(ms);

async function getIssueLinks(issueNumber) {
    const title = `مجلة_الرسالة/العدد_${issueNumber}`;
    try {
        const res = await axios.get(`${BASE_API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=links`, AXIOS_CONFIG);
        if (res.data.error) return [];
        // تصفية الروابط لتشمل فقط مقالات العدد
        const links = res.data.parse.links
            .filter(link => link.ns === 0 && link['*'].startsWith(`مجلة الرسالة/العدد ${issueNumber}/`))
            .map(link => link['*']);
        return [...new Set(links)];
    } catch (err) {
        console.error(`❌ فشل في جلب روابط العدد: ${issueNumber}`, err.message);
        return [];
    }
}

async function fetchArticleText(title) {
    try {
        const res = await axios.get(`${BASE_API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text&section=0`, AXIOS_CONFIG);
        if (res.data.error) return '';
        const html = res.data.parse.text['*'];
        const $ = cheerio.load(html);

        // إزالة الهوامش والمراجع والقوالب
        $('.reference, sup, .mw-editsection, .noprint, .metadata').remove();
        return $('p').text().trim();
    } catch (err) {
        console.error(`❌ فشل في جلب مقال: ${title}`, err.message);
        return '';
    }
}

function cleanText(raw) {
    return raw
        .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, '$2$1') // إزالة ويكي لينك
        .replace(/{{.*?}}/g, '') // إزالة القوالب
        .replace(/\s+/g, ' ')
        .trim();
}

function extractCandidates(text, sourceTitle, issueNumber) {
    const candidates = [];
    const sentences = text.match(/[^.؟!]+[.؟!]+/g) || [];

    sentences.forEach((sent, i) => {
        const clean = sent.trim();
        // الحفاظ على جمل مفيدة
        if (clean.length > 20 && clean.length < 150) {
            candidates.push({
                id: Date.now() + Math.floor(Math.random() * 10000),
                term: 'كلمة_للإستخراج', // للمراجعة لاحقاً
                pronunciation: '',
                category: 'نص مستخرج',
                social_class: 'غير محدد',
                region: 'عموم مصر',
                literal_meaning: '',
                historical_usage: '',
                example: clean,
                modern_equivalent: '',
                notes: `من مجلة الرسالة - عدد ${issueNumber}`,
                source: sourceTitle,
                rarity: 'قيد المراجعة'
            });
        }
    });
    return candidates;
}

(async () => {
    console.log(`🔍 بدء استخراج مقالات مجلة الرسالة (فترة 1940-1950) من العدد ${START_ISSUE} إلى ${END_ISSUE}...`);
    
    const outputFile = path.join(__dirname, 'extracted_40s_terms.json');
    let allEntries = [];
    try { allEntries = JSON.parse(await fs.readFile(outputFile, 'utf8')); } catch { }
    
    // للتبسيط، نأخذ عينة لتشغيل ناجح ولكن يمكن التحكم بها لجميع الأعداد
    for (let issue = START_ISSUE; issue <= END_ISSUE; issue++) {
        console.log(`\n📚 جاري فحص العدد ${issue}...`);
        const links = await getIssueLinks(issue);
        
        if (links.length === 0) {
            console.log(`⚠️ لم يتم العثور على مقالات أو واجهت مشكلة بالعدد ${issue}`);
            await delay(1000);
            continue;
        }
        
        console.log(`✅ تم العثور على ${links.length} مقال في العدد ${issue}`);
        
        for (let j = 0; j < links.length; j++) {
            const title = links[j];
            console.log(`📥 جلب مقال (${j + 1}/${links.length}): ${title}`);
            const text = await fetchArticleText(title);
            if (text) {
                const cleaned = cleanText(text);
                const candidates = extractCandidates(cleaned, title, issue);
                // لأجل ألا يكون الملف ضخماً جداً، نأخذ أفضل 3 جمل معبرة من كل مقال لتوسيع القاموس
                allEntries.push(...candidates.slice(0, 3)); 
            }
            await delay(1500); // احترام سياسات ويكي مصدر (API rate limit)
        }
        
        // حفظ مرحلي بعد كل عدد
        await fs.writeFile(outputFile, JSON.stringify(allEntries, null, 2), 'utf8');
        console.log(`💾 تم حفظ التقدم في extracted_40s_terms.json | الإجمالي حتى الآن: ${allEntries.length} عنصر.`);
    }
    
    console.log(`🎉 انتهت العملية بنجاح!`);
})();