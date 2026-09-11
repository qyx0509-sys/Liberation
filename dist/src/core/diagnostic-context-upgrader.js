
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports) module.exports=api;
 if(root) root.JFDiagnosticContext=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function apply(field,ctx){
 if(!field||!ctx)return field;
 return Object.assign(field,{effectiveSection:ctx.section,collection:ctx.collection});
}
return {apply};
});
