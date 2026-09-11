
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports) module.exports=api;
 if(root) root.JFBooleanSemanticAdapter=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const TRUE=new Set(['true','1','yes','y','是','有','具有','属于','来自']);
const FALSE=new Set(['false','0','no','n','否','无','没有','不是','非']);
function normalize(v){
 const s=String(v??'').trim().toLowerCase();
 if(TRUE.has(s)) return true;
 if(FALSE.has(s)) return false;
 return null;
}
function equivalent(a,b){
 const na=normalize(a), nb=normalize(b);
 return na!==null&&nb!==null?na===nb:false;
}
return {normalize,equivalent};
});
