import { env,pipeline } from '@xenova/transformers';

env.allowLocalModels=false;
env.backends.onnx.wasm.numThreads=1;
env.backends.onnx.wasm.wasmPaths='/wasm/';
// A six-layer pretrained neural transformer encodes sentence meanings locally.
let model:Awaited<ReturnType<typeof pipeline>>|null=null;
let busy=false;
async function getModel(id:number){
  if(model)return model;
  self.postMessage({id,type:'progress',message:'Downloading the semantic neural model (~25 MB)…'});
  model=await pipeline('feature-extraction','Xenova/all-MiniLM-L6-v2',{
    quantized:true,
    progress_callback:(p:{status:string;progress?:number})=>{
      if(p.status==='progress')self.postMessage({id,type:'progress',message:`Downloading neural model${p.progress?` · ${Math.round(p.progress)}%`:''}`});
    }
  });
  return model;
}
function sentences(text:string){
  const result:{text:string;index:number}[]=[];
  const segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  for(const {segment,index} of segmenter.segment(text)){
    let offset=0;
    while(offset<segment.length){
      let length=Math.min(900,segment.length-offset);
      if(offset+length<segment.length){const space=segment.slice(offset,offset+length).lastIndexOf(' ');if(space>300)length=space+1;}
      const value=segment.slice(offset,offset+length).trim();
      if(value)result.push({text:value,index:index+offset});
      offset+=length;
    }
  }
  // Ignore an unfinished trailing sentence when complete sentences are available.
  if(result.length>1&&!/[.!?…][”"'»)]*$/.test(result[result.length-1].text))result.pop();
  return result;
}
const dot=(a:number[],b:number[])=>a.reduce((total,n,i)=>total+n*b[i],0);
self.onmessage=async({data}:{data:{id:number;text:string}})=>{
  const {id,text}=data;
  if(busy){self.postMessage({id,type:'error',message:'Another summary is still running.'});return;}
  if(!text?.trim()){self.postMessage({id,type:'error',message:'Select some text first.'});return;}
  busy=true;
  try{
    const encoder=await getModel(id);
    const candidates=sentences(text);
    const vectors:number[][]=[];
    for(let i=0;i<candidates.length;i+=8){
      self.postMessage({id,type:'progress',message:`Finding key ideas · ${Math.min(i+8,candidates.length)} of ${candidates.length} sentences…`});
      const embeddings=await (encoder as any)(candidates.slice(i,i+8).map(s=>s.text),{pooling:'mean',normalize:true});
      vectors.push(...embeddings.tolist());
    }
    const centroid=Array(vectors[0].length).fill(0) as number[];
    for(const vector of vectors)vector.forEach((value,i)=>centroid[i]+=value/vectors.length);
    const norm=Math.sqrt(dot(centroid,centroid));
    const normalized=centroid.map(n=>n/(norm||1));
    const relevance=vectors.map(v=>dot(v,normalized));
    const count=Math.max(1,Math.min(6,Math.ceil(candidates.length*.3)));
    const selected:number[]=[];
    // Maximal marginal relevance keeps the central ideas and reduces repetition.
    while(selected.length<count){
      let best=-1,score=-Infinity;
      for(let i=0;i<vectors.length;i++){
        if(selected.includes(i))continue;
        const repetition=selected.length?Math.max(...selected.map(j=>dot(vectors[i],vectors[j]))):0;
        const rank=.72*relevance[i]-.28*repetition;
        if(rank>score){score=rank;best=i;}
      }
      if(best<0)break;selected.push(best);
    }
    selected.sort((a,b)=>candidates[a].index-candidates[b].index);
    const result=selected.map(i=>candidates[i].text).join('\n\n');
    if(!result)throw new Error('No sentences found');
    self.postMessage({id,type:'result',result});
  }catch{
    self.postMessage({id,type:'error',message:'The neural model could not run. Check your connection and available memory, then try again.'});
  }finally{busy=false;}
};
