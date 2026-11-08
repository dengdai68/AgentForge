// Visual geometry only. Node/edge identities and task decisions stay unchanged.
export const WORKFLOW_SIDES = ['top', 'right', 'bottom', 'left'];
export const workflowSize = node => ({width:node.width || 140,height:node.height || (node.type==='condition'?76:52)});
const normal = {top:{x:0,y:-1},right:{x:1,y:0},bottom:{x:0,y:1},left:{x:-1,y:0}};
const bounds = node => ({...node.position,...workflowSize(node),id:node.id});
const point = (box,side) => ({x:box.x+(side==='left'?0:side==='right'?box.width:box.width/2),y:box.y+(side==='top'?0:side==='bottom'?box.height:box.height/2)});
const length = (a,b) => Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
function clearSegment(a,b,boxes) {
  return !boxes.some(box=>a.y===b.y ? a.y>box.y+.1&&a.y<box.y+box.height-.1&&Math.max(a.x,b.x)>box.x+.1&&Math.min(a.x,b.x)<box.x+box.width-.1 : a.x>box.x+.1&&a.x<box.x+box.width-.1&&Math.max(a.y,b.y)>box.y+.1&&Math.min(a.y,b.y)<box.y+box.height-.1);
}
// Prefer a straight segment or one right angle, without crossing any node.
// Pinned ports can require a U-shaped/feedback route; X6 then routes orthogonally.
export function workflowRoute(nodes,edge) {
  const boxes=nodes.map(bounds),source=boxes.find(n=>n.id===edge.source),target=boxes.find(n=>n.id===edge.target);
  if(!source||!target)return null;
  let best;
  for(const from of edge.sourcePort?[edge.sourcePort]:WORKFLOW_SIDES)for(const to of edge.targetPort?[edge.targetPort]:WORKFLOW_SIDES) {
    const a=point(source,from),b=point(target,to);
    for(const corner of [{x:b.x,y:a.y},{x:a.x,y:b.y}]) {
      const path=[a,corner,b].filter((p,i,all)=>!i||length(p,all[i-1])>.1);
      if(path.length<2)continue;
      const first={x:path[1].x-a.x,y:path[1].y-a.y},last={x:b.x-path.at(-2).x,y:b.y-path.at(-2).y};
      if(first.x*normal[from].x+first.y*normal[from].y<=0||last.x*normal[to].x+last.y*normal[to].y>=0)continue;
      if(!path.slice(1).every((p,i)=>clearSegment(path[i],p,boxes)))continue;
      const score=length(a,b)+(path.length-2)*24;
      if(!best||score<best.score)best={score,sourcePort:from,targetPort:to,vertices:path.slice(1,-1)};
    }
  }
  return best?{sourcePort:best.sourcePort,targetPort:best.targetPort,vertices:best.vertices}:null;
}
export function routeGraphEdge(cell,nodes,edge) {
  const route=workflowRoute(nodes,edge),sourcePort=route?.sourcePort || edge.sourcePort || 'right',targetPort=route?.targetPort || edge.targetPort || 'left';
  cell.setSource({cell:edge.source,port:sourcePort});cell.setTarget({cell:edge.target,port:targetPort});
  cell.setVertices(route?.vertices || []);
  cell.setRouter(route?{name:'normal'}:{name:'manhattan',args:{padding:24,startDirections:[sourcePort],endDirections:[targetPort]}});
}
export async function formatWorkflowLayout(nodes,edges,elk) {
  if(!nodes.length)return [];
  const result=await elk.layout({id:'workflow',layoutOptions:{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':'64','elk.layered.spacing.nodeNodeBetweenLayers':'100','elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES'},children:nodes.map(node=>({id:node.id,...workflowSize(node)})),edges:edges.map((edge,index)=>({id:'edge_'+index,sources:[edge.source],targets:[edge.target]}))});
  return result.children.map(node=>({id:node.id,position:{x:Math.round(node.x+40),y:Math.round(node.y+40)}}));
}
export function attachWorkflowViewport(graph,viewport,onScale=()=>{}) {
  const update=()=>onScale(graph.zoom()),zoom=factor=>{graph.zoomTo(Math.max(.05,Math.min(3,factor)));update();};
  const wheel=event=>{event.preventDefault();event.stopPropagation();zoom(graph.zoom()*Math.exp(-Math.max(-120,Math.min(120,event.deltaY))*.003));};
  const keyboard=event=>{
    if(event.target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(!['+','=','-','_','0'].includes(event.key))return;
    event.preventDefault();event.stopPropagation();zoom(event.key==='0'?1:graph.zoom()*(['+','='].includes(event.key)?1.2:1/1.2));
  };
  viewport.addEventListener('wheel',wheel,{passive:false,capture:true});viewport.addEventListener('keydown',keyboard);
  graph.on('scale',update);
  return {zoom,update,dispose(){viewport.removeEventListener('wheel',wheel,{capture:true});viewport.removeEventListener('keydown',keyboard);graph.off('scale',update);}};
}
