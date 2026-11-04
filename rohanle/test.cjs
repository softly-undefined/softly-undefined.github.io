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
