const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');
const { setTimeout: sleep } = require('timers/promises');

const BASE_API = 'https://ar.wikisource.org/w/api.php';
const START_ISSUE = 339; 
const END_ISSUE = 900; 

const AXIOS_CONFIG = {
    headers: { 'User-Agent': 'ResalaMagazineExtractor/1.0 (Arabic dictionary bot)' }
};

const delay = (ms) => sleep(ms);

// الكلمات الشائعة والتوقف
const STOP_WORDS = new Set([
    'في', 'من', 'إلى', 'عن', 'على', 'هو', 'هي', 'هم', 'هن', 'أن', 'إن', 'لا', 'ما',
    'و', 'أو', 'ل', 'ب', 'ك', 'ة', 'ه', 'ا', 'و', 'ن', 'ت', 'ي', 'ه', 'ر', 'ل', 'م',
    'كان', 'كانت', 'ليس', 'ليست', 'يكون', 'تكون', 'هذا', 'هذه', 'ذلك', 'تلك',
    'التي', 'الذي', 'اللذان', 'اللتان', 'التين', 'الذين', 'اللواتي',
    'قد', 'لقد', 'قال', 'قالت', 'يقول', 'تقول', 'يقولون', 'تقلن',
    'أن', 'كي', 'لكي', 'حتى', 'لو', 'لما', 'لولا', 'لدى', 'منذ', 'مذ'
]);

async function getIssueLinks(issueNumber) {
    const title = `مجلة_الرسالة/العدد_${issueNumber}`;
    try {
        const res = await axios.get(`${BASE_API}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=links`, AXIOS_CONFIG);
        if (res.data.error) return [];
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
        $('.reference, sup, .mw-editsection, .noprint, .metadata').remove();
        return $('p').text().trim();
    } catch (err) {
        console.error(`❌ فشل في جلب مقال: ${title}`, err.message);
        return '';
    }
}

function cleanText(raw) {
    return raw
        .replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, '$2$1')
        .replace(/{{.*?}}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractWords(text) {
    // تقسيم النص إلى كلمات
    const words = text.split(/[\s\n\t،.؟!؛:""''""–—-]+/).filter(w => w.length > 0);
    
    // تنظيف الكلمات وتصفيتها
    const candidates = [];
    const seen = new Set();
    
    for (let i = 0; i < words.length; i++) {
        let word = words[i].trim();
        
        // تطبيع النص
        word = word.replace(/^['"`\"]+|['"`\"]+$/g, '');
        
        // تخطي الكلمات القصيرة جداً
        if (word.length < 3) continue;
        
        // تخطي كلمات التوقف
        if (STOP_WORDS.has(word)) continue;
        
        // تخطي الأرقام والرموز
        if (/^\d+$/.test(word) || /^[^ء-ي]+$/.test(word)) continue;
        
        // عدم التكرار
        if (seen.has(word)) continue;
        seen.add(word);
        
        // محاولة استخراج السياق (الجملة التي تحتويها)
        const start = Math.max(0, i - 3);
        const end = Math.min(words.length, i + 4);
        const context = words.slice(start, end).join(' ').trim();
        
        candidates.push({
            term: word,
            example: context,
            rarity: 'قيد المراجعة'
        });
    }
    
    return candidates;
}

function createTermEntry(word, example, sourceTitle, issueNumber) {
    return {
        id: Date.now() + Math.floor(Math.random() * 10000),
        term: word,
        pronunciation: '',
        category: 'نص مستخرج',
        social_class: 'غير محدد',
        region: 'عموم مصر',
        literal_meaning: '',
        historical_usage: '',
        example: example,
        modern_equivalent: '',
        notes: `من مجلة الرسالة - عدد ${issueNumber}`,
        source: sourceTitle,
        rarity: 'قيد المراجعة'
    };
}

(async () => {
    console.log(`🔍 بدء استخراج كلمات من مجلة الرسالة (الهدف: 1500 كلمة)...`);
    
    const outputFile = path.join(__dirname, 'extracted_40s_terms.json');
    let allEntries = [];
    
    try { 
        allEntries = JSON.parse(await fs.readFile(outputFile, 'utf8')); 
        console.log(`📌 تم تحميل ${allEntries.length} كلمة موجودة مسبقاً`);
    } catch { }
    
    let totalWords = new Set();
    
    for (let issue = START_ISSUE; issue <= END_ISSUE && allEntries.length < 1500; issue++) {
        console.log(`\n📚 جاري فحص العدد ${issue}... (الإجمالي حالياً: ${allEntries.length})`);
        
        try {
            const links = await getIssueLinks(issue);
            
            if (links.length === 0) {
                console.log(`⚠️ لم يتم العثور على مقالات في العدد ${issue}`);
                await delay(500);
                continue;
            }
            
            console.log(`✅ تم العثور على ${links.length} مقال`);
            
            for (let j = 0; j < links.length && allEntries.length < 1500; j++) {
                const title = links[j];
                console.log(`📥 جلب (${j + 1}/${links.length}): ${title.substring(0, 50)}...`);
                
                const text = await fetchArticleText(title);
                if (text && text.length > 50) {
                    const cleaned = cleanText(text);
                    const wordCandidates = extractWords(cleaned);
                    
                    // إضافة الكلمات الجديدة فقط
                    for (const candidate of wordCandidates) {
                        if (!totalWords.has(candidate.term) && allEntries.length < 1500) {
                            totalWords.add(candidate.term);
                            const entry = createTermEntry(
                                candidate.term, 
                                candidate.example, 
                                title, 
                                issue
                            );
                            allEntries.push(entry);
                        }
                    }
                }
                
                await delay(1000);
            }
            
            // حفظ مرحلي
            await fs.writeFile(outputFile, JSON.stringify(allEntries, null, 2), 'utf8');
            console.log(`💾 تم حفظ ${allEntries.length} كلمة`);
            
        } catch (err) {
            console.error(`❌ خطأ في العدد ${issue}:`, err.message);
            await delay(2000);
        }
        
        if (allEntries.length >= 1500) break;
    }
    
    console.log(`\n✅ انتهت العملية!`);
    console.log(`📊 إجمالي الكلمات المستخرجة: ${allEntries.length}`);
    console.log(`💾 تم الحفظ في: ${outputFile}`);
})();
