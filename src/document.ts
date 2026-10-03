import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
export type Page = {number:number; text:string; start:number; end:number; label?:string};
export type Book = {name:string; author?:string; text:string; pages:Page[]; sample?:boolean};
export type Interval = {start:number; end:number};

export function makeBook(name:string, texts:string[], sample=false):Book {
  let text='';
  const pages=texts.map((page,i)=>{
    if(i) text+='\n\n';
    const start=text.length;
    text+=page;
    return {number:i+1,text:page,start,end:text.length};
  });
  return {name,text,pages,sample};
}
export const sampleBook=makeBook('The art of paying attention',[
  'There is a quiet kind of discovery that begins with paying attention. A familiar street, a sentence in a book, the way light falls across a table: each holds more than we first notice. To read carefully is to give these small discoveries room to unfold.\n\nReading is more than moving from one word to the next. It is a conversation between what is on the page and what we bring to it. We pause, imagine, question, and connect. Sometimes a single paragraph changes the way we understand an entire chapter.\n\nAttention is a limited resource. When we divide it among many tasks, each task receives only a fragment of our curiosity. Giving a book our full attention allows ideas to settle, and allows us to hear what the writer is really trying to say.\n\nListening offers another way into a text. The rhythm of a voice can make a difficult sentence feel natural. A pause can reveal an emphasis we missed. Whether we read with our eyes or listen with our ears, understanding grows when we choose a pace that feels right.',
  'Curiosity turns reading into exploration. When an unfamiliar word appears, we can stop and ask what it means. A definition is a starting point; the surrounding sentence tells us how the writer is using it. Context helps us distinguish a technical meaning from an everyday one.\n\nThe word serendipity describes a fortunate discovery made by chance. Yet chance alone is rarely enough. We need to be attentive enough to recognize the unexpected when it arrives. In this way, curiosity and attention work together.\n\nA useful reading habit is to pause at the end of a passage and explain its main idea in our own words. This small act exposes gaps in understanding. If we cannot describe the idea simply, we may need to return to a sentence and listen again.\n\nSummaries are maps. They help us see the shape of a longer argument, but they cannot replace every detail of the landscape. We use them to find our way, then return to the original whenever precision matters.',
  'A book need not be finished in a single sitting to be understood deeply. Choosing a beginning and an ending gives a reading session a clear shape. A few pages, listened to with care, can be more valuable than many pages rushed through.\n\nDifferent texts ask for different rhythms. A story may invite a continuous flow, while a dense explanation may benefit from a slower voice and frequent pauses. The right pace is the one that leaves space for understanding.\n\nOver time, these small choices form a practice: notice what matters, question what is unfamiliar, and connect new ideas to what you already know. Reading becomes less about reaching the final page and more about carrying something useful away.\n\nWhen you return to a book, you bring a changed perspective. The words remain, but you may hear something new. That is one of the enduring pleasures of reading: there is always another detail waiting for your attention.'
],true);
sampleBook.author='Folio reading sample';
sampleBook.pages.forEach((p,i)=>p.label=['01 · A little room for discovery','02 · Follow your curiosity','03 · Find your own rhythm'][i]);

export async function readPdf(file:File,onProgress:(n:number,total:number)=>void,signal:AbortSignal):Promise<Book> {
  if(file.size>100*1024*1024) throw new Error('Choose a PDF smaller than 100 MB.');
  if(!file.name.toLowerCase().endsWith('.pdf')&&file.type!=='application/pdf') throw new Error('Please choose a PDF file.');
  const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
  const abort=()=>{void task.destroy();};
  signal.addEventListener('abort',abort,{once:true});
  try {
    const pdf=await task.promise;
    const texts:string[]=[];
    for(let i=1;i<=pdf.numPages;i++) {
      if(signal.aborted) throw new DOMException('Cancelled','AbortError');
      const page=await pdf.getPage(i);
      const content=await page.getTextContent();
      let text='';
      for(const item of content.items) {
        if(!('str' in item)) continue;
        if(text&&!/\s$/.test(text)&&item.str&&!/^\s/.test(item.str)) text+=' ';
        text+=item.str;
        if(item.hasEOL) text+='\n';
      }
      texts.push(text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim());
      page.cleanup();
      onProgress(i,pdf.numPages);
    }
    if(!texts.some(t=>t.trim())) throw new Error('This PDF has no readable text. Scanned pages need OCR before they can be read aloud.');
    return makeBook(file.name.replace(/\.pdf$/i,'').replace(/[_-]/g,' '),texts);
  } catch(error) {
    if(signal.aborted) throw new DOMException('Cancelled','AbortError');
    if(error instanceof Error&&error.name==='PasswordException') throw new Error('This PDF is password protected. Save an unlocked copy and try again.');
    throw error;
  } finally {
    signal.removeEventListener('abort',abort);
    await task.destroy();
  }
}

export type SpeechChunk=Interval&{text:string};
export function speechChunks(text:string,start:number,end:number):SpeechChunk[] {
  const source=text.slice(start,end);
  const chunks:SpeechChunk[]=[];
  const segmenter=new Intl.Segmenter(undefined,{granularity:'sentence'});
  for(const {segment,index} of segmenter.segment(source)) {
    let consumed=0;
    while(consumed<segment.length) {
      let length=Math.min(220,segment.length-consumed);
      if(consumed+length<segment.length) {
        const space=segment.slice(consumed,consumed+length).lastIndexOf(' ');
        if(space>80) length=space+1;
      }
      const slice=segment.slice(consumed,consumed+length);
      if(slice.trim()) chunks.push({text:slice,start:start+index+consumed,end:start+index+consumed+length});
      consumed+=length;
    }
  }
  return chunks;
}

export function selectionInterval(root:HTMLElement):Interval|null {
  const selection=window.getSelection();
  if(!selection||selection.isCollapsed||!selection.rangeCount) return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer)) return null;
  function position(node:Node,offset:number) {
    const element=node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement;
    const page=element?.closest<HTMLElement>('[data-page-start]');
    if(!page) return null;
    const before=document.createRange();
    before.selectNodeContents(page);
    before.setEnd(node,offset);
    return Number(page.dataset.pageStart)+before.toString().length;
  }
  const start=position(range.startContainer,range.startOffset),end=position(range.endContainer,range.endOffset);
  return start===null||end===null||start===end?null:{start,end};
}
