import {unzipSync,strFromU8} from 'fflate';
import {XMLParser} from 'fast-xml-parser';
import {compile,evaluate,position,UNKNOWN} from './formula.mjs';
const xml=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,trimValues:false});
const list=v=>v===undefined?[]:Array.isArray(v)?v:[v];
const text=v=>typeof v==='object'?v?.['#text']??'':v??'';
const rich=v=>v?.t!==undefined?String(text(v.t)):list(v?.r).map(r=>text(r.t)).join('');
const MAX_FILE=16*1024*1024,MAX_XML=12*1024*1024;
const indexed=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF','800000','008000','000080','808000','800080','008080','C0C0C0','808080','9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF','000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF','00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99','3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696','003366','339966','003300','333300','993300','993366','333399','333333'];
export function isRed(hex){if(!/^#[\da-f]{6}$/i.test(hex||''))return false;const [r,g,b]=hex.slice(1).match(/../g).map(s=>parseInt(s,16));const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;if(!d||r!==max||r<90||d<24)return false;const hue=((g-b)/d*60+360)%360;return hue<=18||hue>=345;}
function color(node,theme,palette=indexed){if(!node)return undefined;let hex=node['@rgb']?.slice(-6)||palette[Number(node['@indexed'])]||theme[Number(node['@theme'])];if(!/^[\da-f]{6}$/i.test(hex||''))return undefined;const tint=Number(node['@tint']||0);if(tint){const rgb=hex.match(/../g).map(s=>parseInt(s,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),l=(max+min)/2,d=max-min;let h=0,s=0;if(d){s=d/(1-Math.abs(2*l-1));h=max===rgb[0]?((rgb[1]-rgb[2])/d+6)%6:max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4;h*=60;}const light=tint<0?l*(1+tint):l*(1-tint)+tint,c=(1-Math.abs(2*light-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=light-c/2;const a=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];hex=a.map(v=>Math.round((v+m)*255).toString(16).padStart(2,'0')).join('');}return '#'+hex.toUpperCase();}
function range(s){const [a,b=a]=s.split(':'),start=position(a),end=position(b);return start&&end?{start,end}:null;}
const contains=(r,p)=>p.row>=r.start.row&&p.row<=r.end.row&&p.col>=r.start.col&&p.col<=r.end.col;
function archive(bytes){if(bytes.length>MAX_FILE)throw Error('Workbook exceeds the 16 MB compressed-file limit.');const entries=new Map();let total=0;unzipSync(bytes,{filter:f=>{if(entries.has(f.name))throw Error('Duplicate archive entries are not supported.');entries.set(f.name,f.originalSize);if(f.name.endsWith('.xml'))total+=f.originalSize;return false;}});if(entries.size>5000||total>64*1024*1024)throw Error('Workbook exceeds safe parsing limits.');return name=>{if(!entries.has(name))return null;if(entries.get(name)>MAX_XML)throw Error('A workbook part exceeds safe parsing limits.');const value=unzipSync(bytes,{filter:f=>f.name===name})[name];const s=strFromU8(value);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('XML document types and custom entities are not supported.');return xml.parse(s);};}
function cellValue(c,strings){const v=text(c.v),t=c['@t'];if(t==='s')return strings[Number(v)]??'';if(t==='inlineStr')return rich(c.is);if(t==='str')return String(v);if(t==='e')return {error:true,value:String(v)};if(t==='b')return v==='1';if(c.v===undefined||v==='')return c.f!==undefined?UNKNOWN:null;return Number.isFinite(Number(v))?Number(v):String(v);}
function ruleMatch(rule,cell,lookup){const n=rule.node,t=n['@type'],v=cell.value,p=cell.pos,o=rule.origin;
  if(v===UNKNOWN)return UNKNOWN;
  if(t==='containsErrors')return v?.error===true;if(t==='notContainsErrors')return !v?.error;
  if(t==='containsBlanks')return v===null||typeof v==='string'&&v.trim()==='';if(t==='notContainsBlanks')return !(v===null||typeof v==='string'&&v.trim()==='');
  if(t==='expression'){const result=evaluate(rule.formulas[0],lookup,o,p);return result===UNKNOWN?UNKNOWN:Boolean(result);}
  if(['containsText','notContainsText','beginsWith','endsWith'].includes(t)){if(n['@text']===undefined)return UNKNOWN;const value=String(v?.value??v??'').toLowerCase(),query=n['@text'].toLowerCase();return t==='containsText'?value.includes(query):t==='notContainsText'?!value.includes(query):t==='beginsWith'?value.startsWith(query):value.endsWith(query);}
  if(t==='cellIs'){const a=evaluate(rule.formulas[0],lookup,o,p),b=rule.formulas[1]?evaluate(rule.formulas[1],lookup,o,p):null;if(a===UNKNOWN||b===UNKNOWN||v?.error)return UNKNOWN;const op=n['@operator'],value=v===null?(typeof a==='string'?'':0):v;const cmp=(x,y)=>typeof x==='string'&&typeof y==='string'?x.toLowerCase()===y.toLowerCase():x===y;
    if(op==='equal')return cmp(value,a);if(op==='notEqual')return !cmp(value,a);if(typeof value!==typeof a)return UNKNOWN;
    return op==='greaterThan'?value>a:op==='greaterThanOrEqual'?value>=a:op==='lessThan'?value<a:op==='lessThanOrEqual'?value<=a:op==='between'?value>=a&&value<=b:op==='notBetween'?value<a||value>b:UNKNOWN;}
  return UNKNOWN;
}
function numberColor(format,value){if(typeof value!=='number'||!format)return undefined;const parts=format.split(';');if(parts.some(p=>/\[(?:[<>]=?|=)/.test(p)))return UNKNOWN;const section=value<0?(parts[1]??parts[0]):value===0?(parts[2]??parts[0]):parts[0];const m=/\[(Red|Black|White|Blue|Green|Yellow|Magenta|Cyan|Color\d+)\]/i.exec(section);if(!m)return undefined;return /^(red|color3)$/i.test(m[1])?'#FF0000':'#000000';}
export function parseWorkbook(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),read=archive(bytes),book=read('xl/workbook.xml')?.workbook;if(!book)throw Error('Select a valid .xlsx workbook.');
  const styles=read('xl/styles.xml')?.styleSheet||{},scheme=read('xl/theme/theme1.xml')?.theme?.themeElements?.clrScheme||{};
  const theme=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].map(k=>scheme[k]?.srgbClr?.['@val']||scheme[k]?.sysClr?.['@lastClr']);
  const palette=list(styles.colors?.indexedColors?.rgbColor).map(c=>c['@rgb']?.slice(-6));
  const colors=n=>color(n,theme,palette.length?palette:indexed);
  const formats=new Map([['38','#,##0;[Red](#,##0)'],['40','#,##0.00;[Red](#,##0.00)'],...list(styles.numFmts?.numFmt).map(n=>[n['@numFmtId'],n['@formatCode']])]);
  const fill=(v,differential=false)=>{const p=v?.patternFill;return p&&(p['@patternType']==='solid'||differential)?colors(p.fgColor)||colors(p.bgColor):undefined;};
  const fonts=list(styles.fonts?.font),fills=list(styles.fills?.fill),xfs=list(styles.cellXfs?.xf),base=list(styles.cellStyleXfs?.xf),dxfs=list(styles.dxfs?.dxf);
  const styleCache=new Map();function style(index){if(styleCache.has(index))return styleCache.get(index);const own=xfs[index]||{},parent=base[Number(own['@xfId'])]||{},xf={...parent,...own};const result={font:colors(fonts[Number(xf['@fontId']||0)]?.color),fill:fill(fills[Number(xf['@fillId']||0)]),numberFormat:formats.get(xf['@numFmtId'])};styleCache.set(index,result);return result;}
  const differential=dxfs.map(d=>({font:colors(d.font?.color),fill:fill(d.fill,true),numberFormat:d.numFmt?.['@formatCode']}));
  const stringNodes=list(read('xl/sharedStrings.xml')?.sst?.si),strings=stringNodes.map(rich);
  const redRuns=v=>list(v?.r).filter(r=>rich({t:r.t})!=='').map(r=>colors(r.rPr?.color)).filter(isRed);
  const sharedReds=stringNodes.map(redRuns);
  const rels=new Map(list(read('xl/_rels/workbook.xml.rels')?.Relationships?.Relationship).filter(r=>r['@TargetMode']!=='External').map(r=>[r['@Id'],r['@Target']]));
  const warnings=new Map(),warn=(code,sheet,detail)=>{const key=code+'|'+sheet+'|'+detail;const previous=warnings.get(key);if(previous)previous.count++;else warnings.set(key,{code,sheet,detail,count:1});};
  const rows=[],sheets=[];let scanned=0,flags=0,missingCache=0;
  for(const sheet of list(book.sheets?.sheet)){
    let target=rels.get(sheet['@id']);if(!target)throw Error('A worksheet relationship is missing.');target=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');if(target.includes('..'))throw Error('Unsupported worksheet path.');
    const root=read(target)?.worksheet;if(!root){warn('sheet_unreadable',sheet['@name'],'Worksheet could not be read.');continue;}
    const sheetName=sheet['@name'],cells=new Map(),rowCells=new Map();let sheetFlags=0;
    const columns=list(root.cols?.col);
    for(const row of list(root.sheetData?.row))for(const c of list(row.c)){const ref=c['@r'],pos=position(ref);if(!pos)continue;const value=cellValue(c,strings);const cell={ref,pos,value,formula:c.f!==undefined,redRuns:c['@t']==='s'?sharedReds[Number(text(c.v))]||[]:redRuns(c.is),style:Number(c['@s']??(row['@customFormat']==='1'?row['@s']:undefined)??columns.find(col=>pos.col>=Number(col['@min'])&&pos.col<=Number(col['@max']))?.['@style']??0)};cells.set(ref,cell);if(value!==null&&value!==''){const entries=rowCells.get(pos.row)||[];entries.push(cell);rowCells.set(pos.row,entries);}if(value===UNKNOWN)missingCache++;}
    if(cells.size>100000||scanned+cells.size>600000)throw Error('Workbook exceeds the 600,000-cell or 100,000-cell-per-sheet limit.');scanned+=cells.size;
    const lookup=ref=>cells.get(ref)?.value??null;
    const rules=[];
    for(const cf of list(root.conditionalFormatting)){
      const ranges=String(cf['@sqref']||'').split(/\s+/).map(range).filter(Boolean);
      if(!ranges.length){warn('range_unsupported',sheetName,'A conditional-format range could not be read.');continue;}
      for(const node of list(cf.cfRule)){const type=node['@type'];const rule={node,ranges,origin:ranges[0].start,formulas:list(node.formula).map(v=>compile(String(text(v)))),style:differential[Number(node['@dxfId'])]||{}};rules.push(rule);
        if(['dataBar','iconSet','colorScale'].includes(type))warn('visual_rule',sheetName,type+' display is not evaluated.');
      }
    }
    rules.sort((a,b)=>Number(a.node['@priority'])-Number(b.node['@priority']));
    // Index rules by bounded column spans to avoid a full rules × cells scan.
    const ruleIndex=new Map(),wide=[];for(const rule of rules){const cols=new Set();for(const r of rule.ranges)if(r.end.col-r.start.col>256){wide.push(rule);break;}else for(let c=r.start.col;c<=r.end.col;c++)cols.add(c);if(!wide.includes(rule))for(const c of cols){const a=ruleIndex.get(c)||[];a.push(rule);ruleIndex.set(c,a);}}
    const flaggedByRow=new Map();
    for(const cell of cells.values()){
      if(cell.value===null||cell.value===''||cell.value===UNKNOWN)continue;
      const effective={...style(cell.style)},overrides={},origins={},candidates=[...(ruleIndex.get(cell.pos.col)||[]),...wide].sort((a,b)=>Number(a.node['@priority'])-Number(b.node['@priority']));let uncertain=false;
      for(const rule of candidates){if(!rule.ranges.some(r=>contains(r,cell.pos)))continue;const result=ruleMatch(rule,cell,lookup);if(result===UNKNOWN){const t=rule.node['@type'];if(!['dataBar','iconSet','colorScale'].includes(t))warn('rule_unsupported',sheetName,'Some '+t+' rules could not be evaluated from saved values.');uncertain=true;continue;}if(result){for(const prop of ['font','fill','numberFormat'])if(rule.style[prop]!==undefined&&overrides[prop]===undefined){overrides[prop]=rule.style[prop];origins[prop]='conditional';}if(rule.node['@stopIfTrue']==='1')break;}}
      Object.assign(effective,overrides);const numColor=numberColor(effective.numberFormat,cell.value);if(numColor===UNKNOWN){warn('number_format',sheetName,'Conditional number-format colors need review.');uncertain=true;}else if(numColor){effective.font=numColor;origins.font='number format';}
      const reasons=[];for(const prop of ['font','fill'])if(isRed(effective[prop]))reasons.push({kind:prop,color:effective[prop],source:origins[prop]||'cell style'});
      if(!overrides.font&&!numColor&&cell.redRuns.length&&!reasons.some(r=>r.kind==='font'))reasons.push({kind:'font',color:cell.redRuns[0],source:'rich text'});
      if(!reasons.length)continue;
      if(flags>=10000)throw Error('More than 10,000 flagged cells. Use a smaller workbook or selected worksheets.');flags++;sheetFlags++;
      const a=flaggedByRow.get(cell.pos.row)||[];a.push({cell:cell.ref,value:cell.value?.error?cell.value.value:cell.value,formula_value:cell.formula,reasons,needs_review:uncertain});flaggedByRow.set(cell.pos.row,a);
    }
    for(const [row,items]of flaggedByRow){const context=(rowCells.get(row)||[]).filter(c=>typeof c.value==='string'&&!items.some(x=>x.cell===c.ref)).slice(0,3).map(c=>({cell:c.ref,value:c.value.slice(0,200)}));rows.push({sheet:sheetName,row,hidden:sheet['@state']==='hidden'||sheet['@state']==='veryHidden',context,items});}
    if(root.extLst)warn('extensions',sheetName,'Extended worksheet formatting may need review.');
    if(root.tableParts)warn('table_styles',sheetName,'Table styles are not evaluated.');
    sheets.push({name:sheetName,scanned_cells:cells.size,flagged_cells:sheetFlags});
  }
  if(missingCache)warn('missing_values',null,`${missingCache} formula cells have no saved result. Recalculate and save in Excel.`);
  if(book.calcPr?.['@calcMode']==='manual'||book.calcPr?.['@fullCalcOnLoad']==='1')warn('calculation',null,'Workbook requests recalculation; saved formula results may be stale.');
  return {version:1,generated_at:new Date().toISOString(),coverage:warnings.size?'partial':'supported_rules',scanned_cells:scanned,flagged_cells:flags,flagged_rows:rows.length,sheets,rows,warnings:[...warnings.values()],note:'Flags report formatting, not independently verified errors. Formula values are saved workbook results; this reader does not recalculate the workbook.'};
}
