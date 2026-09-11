/*
 * Phase 2.3-E Runtime Context Bridge
 * Connects field context -> matcher/filler/verification.
 */
(function(root,factory){
 const api=factory();
 if(typeof module==="object"&&module.exports) module.exports=api;
 if(root) root.JFRuntimeContextBridge=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
 "use strict";

 function attach(field, context){
   if(!field) return field;
   field.context = {
     ...(field.context||{}),
     ...(context||{})
   };
   field.effectiveSection =
     field.context.effectiveSection ||
     field.context.section ||
     field.section ||
     "";
   field.collection =
     field.context.collection ||
     field.collection ||
     "";
   return field;
 }

 function getSection(field){
   return field?.context?.effectiveSection ||
     field?.effectiveSection ||
     field?.section ||
     "";
 }

 return {attach,getSection};
});
