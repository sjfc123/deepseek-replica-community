"use strict";(globalThis.rspackChunkdeepseek_app_replica=globalThis.rspackChunkdeepseek_app_replica||[]).push([[2115],{24787(t,e,a){function r(t,e){var a,r,l;t.accDescr&&(null==(a=e.setAccDescription)||a.call(e,t.accDescr)),t.accTitle&&(null==(r=e.setAccTitle)||r.call(e,t.accTitle)),t.title&&(null==(l=e.setDiagramTitle)||l.call(e,t.title))}a.d(e,{S:()=>r}),(0,a(49042).K2)(r,"populateCommonDb")},50030(t,e,a){a.d(e,{diagram:()=>D});var r=a(24787),l=a(52127),i=a(88453),n=a(49042),s=a(33542),o={showLegend:!0,ticks:5,max:null,min:0,graticule:"circle"},c={axes:[],curves:[],options:o},d=structuredClone(c),u=n.UI.radar,g=(0,n.K2)(()=>(0,l.$t)({...u,...(0,n.zj)().radar}),"getConfig"),p=(0,n.K2)(()=>d.axes,"getAxes"),h=(0,n.K2)(()=>d.curves,"getCurves"),x=(0,n.K2)(()=>d.options,"getOptions"),m=(0,n.K2)(t=>{d.axes=t.map(t=>{var e;return{name:t.name,label:null!=(e=t.label)?e:t.name}})},"setAxes"),$=(0,n.K2)(t=>{d.curves=t.map(t=>{var e;return{name:t.name,label:null!=(e=t.label)?e:t.name,entries:v(t.entries)}})},"setCurves"),v=(0,n.K2)(t=>{if(void 0==t[0].axis)return t.map(t=>t.value);let e=p();if(0===e.length)throw Error("Axes must be populated before curves for reference entries");return e.map(e=>{let a=t.find(t=>{var a;return(null==(a=t.axis)?void 0:a.$refText)===e.name});if(void 0===a)throw Error("Missing entry for axis "+e.label);return a.value})},"computeCurveEntries"),f={getAxes:p,getCurves:h,getOptions:x,setAxes:m,setCurves:$,setOptions:(0,n.K2)(t=>{var e,a,r,l,i,n,s,c,u,g;let p=t.reduce((t,e)=>(t[e.name]=e,t),{});d.options={showLegend:null!=(e=null==(n=p.showLegend)?void 0:n.value)?e:o.showLegend,ticks:null!=(a=null==(s=p.ticks)?void 0:s.value)?a:o.ticks,max:null!=(r=null==(c=p.max)?void 0:c.value)?r:o.max,min:null!=(l=null==(u=p.min)?void 0:u.value)?l:o.min,graticule:null!=(i=null==(g=p.graticule)?void 0:g.value)?i:o.graticule}},"setOptions"),getConfig:g,clear:(0,n.K2)(()=>{(0,n.IU)(),d=structuredClone(c)},"clear"),setAccTitle:n.SV,getAccTitle:n.iN,setDiagramTitle:n.ke,getDiagramTitle:n.ab,getAccDescription:n.m7,setAccDescription:n.EI},y=(0,n.K2)(t=>{(0,r.S)(t,f);let{axes:e,curves:a,options:l}=t;f.setAxes(e),f.setCurves(a),f.setOptions(l)},"populate"),b={parse:(0,n.K2)(async t=>{let e=await (0,s.qg)("radar",t);n.Rm.debug(e),y(e)},"parse")},w=(0,n.K2)((t,e,a,r)=>{var l;let n=r.db,s=n.getAxes(),o=n.getCurves(),c=n.getOptions(),d=n.getConfig(),u=n.getDiagramTitle(),g=C((0,i.D)(e),d),p=null!=(l=c.max)?l:Math.max(...o.map(t=>Math.max(...t.entries))),h=c.min,x=Math.min(d.width,d.height)/2;M(g,s,x,c.ticks,c.graticule),K(g,s,x,d),T(g,s,o,h,p,c.graticule,d),A(g,o,c.showLegend,d),g.append("text").attr("class","radarTitle").text(u).attr("x",0).attr("y",-d.height/2-d.marginTop)},"draw"),C=(0,n.K2)((t,e)=>{let a=e.width+e.marginLeft+e.marginRight,r=e.height+e.marginTop+e.marginBottom,l={x:e.marginLeft+e.width/2,y:e.marginTop+e.height/2};return t.attr("viewbox",`0 0 ${a} ${r}`).attr("width",a).attr("height",r),t.append("g").attr("transform",`translate(${l.x}, ${l.y})`)},"drawFrame"),M=(0,n.K2)((t,e,a,r,l)=>{if("circle"===l)for(let e=0;e<r;e++){let l=a*(e+1)/r;t.append("circle").attr("r",l).attr("class","radarGraticule")}else if("polygon"===l){let l=e.length;for(let i=0;i<r;i++){let n=a*(i+1)/r,s=e.map((t,e)=>{let a=2*e*Math.PI/l-Math.PI/2,r=n*Math.cos(a),i=n*Math.sin(a);return`${r},${i}`}).join(" ");t.append("polygon").attr("points",s).attr("class","radarGraticule")}}},"drawGraticule"),K=(0,n.K2)((t,e,a,r)=>{let l=e.length;for(let i=0;i<l;i++){let n=e[i].label,s=2*i*Math.PI/l-Math.PI/2;t.append("line").attr("x1",0).attr("y1",0).attr("x2",a*r.axisScaleFactor*Math.cos(s)).attr("y2",a*r.axisScaleFactor*Math.sin(s)).attr("class","radarAxisLine"),t.append("text").text(n).attr("x",a*r.axisLabelFactor*Math.cos(s)).attr("y",a*r.axisLabelFactor*Math.sin(s)).attr("class","radarAxisLabel")}},"drawAxes");function T(t,e,a,r,l,i,n){let s=e.length,o=Math.min(n.width,n.height)/2;a.forEach((e,a)=>{if(e.entries.length!==s)return;let c=e.entries.map((t,e)=>{let a=2*Math.PI*e/s-Math.PI/2,i=k(t,r,l,o);return{x:i*Math.cos(a),y:i*Math.sin(a)}});"circle"===i?t.append("path").attr("d",L(c,n.curveTension)).attr("class",`radarCurve-${a}`):"polygon"===i&&t.append("polygon").attr("points",c.map(t=>`${t.x},${t.y}`).join(" ")).attr("class",`radarCurve-${a}`)})}function k(t,e,a,r){return r*(Math.min(Math.max(t,e),a)-e)/(a-e)}function L(t,e){let a=t.length,r=`M${t[0].x},${t[0].y}`;for(let l=0;l<a;l++){let i=t[(l-1+a)%a],n=t[l],s=t[(l+1)%a],o=t[(l+2)%a],c={x:n.x+(s.x-i.x)*e,y:n.y+(s.y-i.y)*e},d={x:s.x-(o.x-n.x)*e,y:s.y-(o.y-n.y)*e};r+=` C${c.x},${c.y} ${d.x},${d.y} ${s.x},${s.y}`}return`${r} Z`}function A(t,e,a,r){if(!a)return;let l=(r.width/2+r.marginRight)*3/4,i=-(3*(r.height/2+r.marginTop))/4;e.forEach((e,a)=>{let r=t.append("g").attr("transform",`translate(${l}, ${i+20*a})`);r.append("rect").attr("width",12).attr("height",12).attr("class",`radarLegendBox-${a}`),r.append("text").attr("x",16).attr("y",0).attr("class","radarLegendText").text(e.label)})}(0,n.K2)(T,"drawCurves"),(0,n.K2)(k,"relativeRadius"),(0,n.K2)(L,"closedRoundCurve"),(0,n.K2)(A,"drawLegend");var S=(0,n.K2)((t,e)=>{let a="";for(let r=0;r<t.THEME_COLOR_LIMIT;r++){let l=t[`cScale${r}`];a+=`
		.radarCurve-${r} {
			color: ${l};
			fill: ${l};
			fill-opacity: ${e.curveOpacity};
			stroke: ${l};
			stroke-width: ${e.curveStrokeWidth};
		}
		.radarLegendBox-${r} {
			fill: ${l};
			fill-opacity: ${e.curveOpacity};
			stroke: ${l};
		}
		`}return a},"genIndexStyles"),I=(0,n.K2)(t=>{let e=(0,n.P$)(),a=(0,n.zj)(),r=(0,l.$t)(e,a.themeVariables),i=(0,l.$t)(r.radar,t);return{themeVariables:r,radarOptions:i}},"buildRadarStyleOptions"),D={parser:b,db:f,renderer:{draw:w},styles:(0,n.K2)(function(){let{radar:t}=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},{themeVariables:e,radarOptions:a}=I(t);return`
	.radarTitle {
		font-size: ${e.fontSize};
		color: ${e.titleColor};
		dominant-baseline: hanging;
		text-anchor: middle;
	}
	.radarAxisLine {
		stroke: ${a.axisColor};
		stroke-width: ${a.axisStrokeWidth};
	}
	.radarAxisLabel {
		dominant-baseline: middle;
		text-anchor: middle;
		font-size: ${a.axisLabelFontSize}px;
		color: ${a.axisColor};
	}
	.radarGraticule {
		fill: ${a.graticuleColor};
		fill-opacity: ${a.graticuleOpacity};
		stroke: ${a.graticuleColor};
		stroke-width: ${a.graticuleStrokeWidth};
	}
	.radarLegendText {
		text-anchor: start;
		font-size: ${a.legendFontSize}px;
		dominant-baseline: hanging;
	}
	${S(e,a)}
	`},"styles")}}}]);