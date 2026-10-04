// A deliberately bounded expression interpreter. It never executes workbook code.
export const UNKNOWN=Symbol('unknown');
export function position(ref){const m=/^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})$/i.exec(ref||'');if(!m)return null;let col=0;for(const c of m[1].toUpperCase())col=col*26+c.charCodeAt(0)-64;const row=Number(m[2]);return col<=16384&&row<=1048576?{col,row}:null;}
export function address(col,row){let s='';for(;col>0;col=Math.floor((col-1)/26))s=String.fromCharCode(65+(col-1)%26)+s;return s+row;}
export function compile(text){
  try{
    if(typeof text!=='string'||text.length>1024)return null;
    const tokens=text.replace(/^=/,'').match(/"(?:[^"]|"")*"|\$?[A-Za-z]{1,3}\$?[1-9]\d*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[A-Za-z_]+|<>|>=|<=|[=<>+*/(),-]|\S/g)||[];
    if(tokens.length>256)return null;let i=0,depth=0;
    const atom=()=>{if(++depth>24)throw Error();const t=tokens[i++];let a;
      if(t==='('){a=expr(0);if(tokens[i++]!==')')throw Error();}
      else if(t==='-'||t==='+')a={unary:t,arg:atom()};
      else if(/^"(?:[^"]|"")*"$/.test(t))a={literal:t.slice(1,-1).replace(/""/g,'"')};
      else if(/^(?:\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?$/.test(t))a={literal:Number(t)};
      else if(position(t))a={ref:t.toUpperCase()};
      else if(/^(TRUE|FALSE)$/i.test(t))a={literal:t.toUpperCase()==='TRUE'};
      else if(/^(AND|OR|NOT|ISBLANK|ISERROR|ISNUMBER|ISTEXT|LEN|ABS)$/i.test(t)&&tokens[i++]==='('){const args=[];if(tokens[i]!==')')do{args.push(expr(0));if(tokens[i]!==',')break;i++;}while(true);if(tokens[i++]!==')')throw Error();a={fn:t.toUpperCase(),args};}
      else throw Error();depth--;return a;
    };
    const precedence={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'+':2,'-':2,'*':3,'/':3};
    const expr=min=>{let a=atom();while((precedence[tokens[i]]||0)>min){const op=tokens[i++];a={op,a,b:expr(precedence[op])};}return a;};
    const result=expr(0);return i===tokens.length?result:null;
  }catch{return null;}
}
export function evaluate(node,lookup,origin,target){
  if(!node)return UNKNOWN;
  if('literal'in node)return node.literal;
  if(node.ref){const p=position(node.ref);const col=p.col+(node.ref.startsWith('$')?0:target.col-origin.col),row=p.row+(/\$\d+$/.test(node.ref)?0:target.row-origin.row);return col>0&&row>0?lookup(address(col,row)):UNKNOWN;}
  if(node.unary){const v=evaluate(node.arg,lookup,origin,target);return v===UNKNOWN||typeof v==='string'?UNKNOWN:(node.unary==='-'?-1:1)*Number(v);}
  if(node.fn){const a=node.args.map(n=>evaluate(n,lookup,origin,target));if(a.includes(UNKNOWN))return UNKNOWN;
    switch(node.fn){case'AND':return a.every(Boolean);case'OR':return a.some(Boolean);case'NOT':return a.length===1?!a[0]:UNKNOWN;case'ISBLANK':return a[0]===null;case'ISERROR':return a[0]?.error===true;case'ISNUMBER':return typeof a[0]==='number';case'ISTEXT':return typeof a[0]==='string';case'LEN':return String(a[0]??'').length;case'ABS':return typeof a[0]==='number'?Math.abs(a[0]):UNKNOWN;default:return UNKNOWN;}
  }
  let a=evaluate(node.a,lookup,origin,target),b=evaluate(node.b,lookup,origin,target);if(a===UNKNOWN||b===UNKNOWN||a?.error||b?.error)return UNKNOWN;
  if(a===null)a=typeof b==='string'?'':0;if(b===null)b=typeof a==='string'?'':0;
  if(typeof a==='string'&&typeof b==='string'){a=a.toLowerCase();b=b.toLowerCase();}
  switch(node.op){case'=':return a===b;case'<>':return a!==b;case'>':case'<':case'>=':case'<=':if(typeof a!==typeof b)return UNKNOWN;return node.op==='>'?a>b:node.op==='<'?a<b:node.op==='>='?a>=b:a<=b;
    case'+':case'-':case'*':case'/':if(typeof a!=='number'||typeof b!=='number')return UNKNOWN;return node.op==='+'?a+b:node.op==='-'?a-b:node.op==='*'?a*b:b?a/b:UNKNOWN;
    default:return UNKNOWN;}
}
