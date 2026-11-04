const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'index.html'),'utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',dataset:{},setAttribute(k,v){this[k]=v},replaceChildren(...v){this.children=v},append(){},addEventListener(k,v){this[k]=v},focus(){},select(){}});return elements.get(id)}
const tabs=['rohan','eric','meilin'].map(t=>{const e=el('tab-'+t);e.dataset.target=t;return e});
const input=el('word');let minimum=4,maximum=6;
Object.defineProperties(input,{minLength:{get:()=>minimum,set(value){if(value>maximum)throw new RangeError('minLength exceeds maxLength');minimum=value}},maxLength:{get:()=>maximum,set(value){if(value<minimum)throw new RangeError('maxLength below minLength');maximum=value}}});
const storage=new Map();const context=vm.createContext({document:{getElementById:el,querySelector:()=>el('heading'),querySelectorAll:()=>tabs,createElement:()=>el(Symbol()),addEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},setInterval(){},navigator:{},console});
vm.runInContext(script,context);
function run(s){return vm.runInContext(s,context)}
assert.equal(run('TARGET'),'rohan');
for(let i=0;i<3;i++){
 tabs[i].onclick();
 assert.equal(run('TARGET'),tabs[i].dataset.target);
 assert(run('distance.get(start)>=5'));
 run("path.push(toward.get(start));hints=2;save();render()");
 assert.equal(el('word').maxLength,tabs[i].dataset.target.length);
 assert(run('shareResult()').startsWith(['Rohanle','Ericle','Meilinle'][i]));
}
for(const tab of tabs){tab.onclick();assert.equal(run('path.length'),2);assert.equal(run('hints'),2);run('while(path.at(-1)!==TARGET)path.push(toward.get(path.at(-1)));save();render()');assert.equal(el('word').disabled,true)}
tabs[0].onkeydown({key:'ArrowRight',preventDefault(){}});assert.equal(run('TARGET'),'eric');
assert.equal(tabs[1]['aria-selected'],'true');
for(const i of [0,2,1,2,0,1,0,2]){tabs[i].onclick();assert.equal(run('TARGET'),tabs[i].dataset.target);assert.equal(input.minLength,tabs[i].dataset.target.length);assert.equal(input.maxLength,tabs[i].dataset.target.length)}
tabs[1].onclick();
run("key='2000-01-01';checkDay()");assert.equal(run('TARGET'),'eric');assert.equal(run('path.at(-1)'), 'eric');
console.log('PASS: three reachable daily puzzles, separate progress/hints, wins, sharing, keyboard tabs, day check');

// Audit the complete source subset, rather than only a few reported words.
const sourceWords=fs.readFileSync(require('path').join(__dirname,'dictionary/enable-4-6.txt'),'utf8').trim().split('\n');
assert.equal(sourceWords.length,27771);
assert.equal(new Set(sourceWords).size,sourceWords.length);
const accepted=run('WORDS');
for(const w of sourceWords){assert(/^[a-z]{4,6}$/.test(w));assert(accepted.has(w),`Missing ENABLE word: ${w}`)}
for(const w of run('[...startWords,...fiveLetterStartWords,...targets]'))assert(accepted.has(w),`Missing curated word: ${w}`);
for(const w of 'paid feet held hang okay proud events went gone made said took eaten mice geese teeth women men children dogs cats walks walked babies cities tries tried trying played playing running better best'.split(' ').filter(w=>w.length>=4&&w.length<=6))assert(accepted.has(w),`Missing familiar inflection: ${w}`);
for(const w of ['zzzz','qzxq','1234','pa!d','pay','payments'])assert(!accepted.has(w));

// Every hint must stay within the legal dictionary, change one letter, and
// reduce shortest distance by one; this checks the entire reachable graph.
for(const tab of tabs){tab.onclick();const routes=run('[...toward]'),distances=run('distance');for(const [word,next] of routes){assert(accepted.has(word)&&accepted.has(next));assert.equal(word.length,next.length);assert.equal([...word].filter((c,i)=>c!==next[i]).length,1);assert.equal(distances.get(next),distances.get(word)-1)}}

// Exercise actual submission handlers, including the reported uppercase PAID.
tabs[1].onclick();run("path=[start];const toSaid=buildRoutes('said',WORDS).toward;while(path.at(-1)!=='said')path.push(toSaid.get(path.at(-1)));hints=0;render()");
function submit(word){input.value=word;el('form').submit({preventDefault(){}})}
submit('  PAID  ');assert.equal(run('path.at(-1)'),'paid');
assert.equal(el('message').textContent,'');
el('hint').onclick();assert(el('message').textContent.startsWith('Try '));
run('load()');assert.equal(run('path.at(-1)'),'paid');assert.equal(run('hints'),1);
submit('feet');assert.equal(run('path.at(-1)'),'paid');assert(el('message').textContent.includes('is a word'));
submit('zzzz');assert(el('message').textContent.includes('dictionary'));
submit('pa!d');assert(el('message').textContent.includes('A–Z'));
submit('pay');assert(el('message').textContent.includes('4-letter'));
tabs[0].onclick();run('path=[start];render()');submit('PAID');assert(el('message').textContent.includes('5-letter'));
assert(html.includes('<form id="form" novalidate>'),'Submission validation must handle trimmed input itself');
console.log(`PASS: ${accepted.size.toLocaleString()} accepted words; complete ENABLE/curated coverage, all hint routes, PAID submission, progress reload, and rejection messages`);
