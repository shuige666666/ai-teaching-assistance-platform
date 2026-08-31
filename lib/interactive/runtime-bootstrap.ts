// 存储兼容与错误转发裁剪自 OpenMAIC lib/utils/iframe.ts；来源与 MIT 许可见 THIRD_PARTY_NOTICES.md。
const CODE_WORKER = String.raw`
self.onmessage = async ({data}) => {
  let stdout = '';
  const append = (...args) => { stdout = (stdout + args.map(String).join(' ') + '\n').slice(-20000); };
  try {
    let py;
    if (data.language === 'python') {
      importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js');
      py = await loadPyodide({indexURL:'https://cdn.jsdelivr.net/pyodide/v0.26.2/full/'});
      py.setStdout({batched:append});
      py.setStderr({batched:append});
    }
    postMessage({kind:'executing'});
    if (py) await py.runPythonAsync(data.code);
    else {
      const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
      await new AsyncFunction('console', data.code)({log:append,info:append,warn:append,error:append});
    }
    postMessage({kind:'result',stdout});
  } catch(error) {
    postMessage({kind:'error',message:String(error && error.message || error).slice(0,4000),stdout});
  }
};`;

/** 注入页面独立运行的桥接和可终止代码执行入口，不读取宿主状态或服务端凭据。 */
export function buildRuntimeBootstrap(): string {
  return `<script data-interactive-runtime="2">
(() => {
  const workerSource = ${JSON.stringify(CODE_WORKER)};
  let completed = false, readySent = false, resetHandler = () => {}, active = null;
  const send = (type, extra = {}) => parent.postMessage({type,version:1,...extra}, '*');
  const error = (value) => send('INTERACTIVE_ERROR',{message:String(value && value.message || value || '互动初始化失败').slice(0,300)});
  const ready = () => { if(!readySent){readySent=true;send('INTERACTIVE_READY');} };
  // 沙箱真实存储不可用时提供内存兼容，不持久化也不访问宿主存储。
  for (const name of ['localStorage','sessionStorage']) {
    try { window[name].getItem('__probe__'); } catch (_) {
      const data = new Map();
      try { Object.defineProperty(window,name,{value:{getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),clear:()=>data.clear(),key:i=>[...data.keys()][i]??null,get length(){return data.size;}}}); } catch (_) {}
    }
  }
  function stopCode(){ if(active) active.finish(new Error('运行已停止')); }
  function runCode({language='python',code,timeoutMs=5000}) {
    if(!['python','javascript'].includes(language)||typeof code!=='string')return Promise.reject(new Error('不支持的语言或代码输入'));
    if(active)return Promise.reject(new Error('已有代码正在运行，请先停止'));
    return new Promise((resolve,reject)=>{
      const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
      let worker;
      try { worker=new Worker(url); } catch(e){ URL.revokeObjectURL(url);reject(e);return; }
      let settled=false;
      const finish=(failure,result)=>{
        if(settled)return;settled=true;clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);active=null;
        if(failure)reject(failure);else resolve(result);
      };
      // 下载运行时与执行分别限时，避免 CDN 慢被误认为学生死循环。
      let timer=setTimeout(()=>finish(new Error('运行环境加载超时，请检查网络后重试')),60000);
      active={finish};
      worker.onmessage=({data})=>{
        if(data.kind==='executing'){
          clearTimeout(timer);timer=setTimeout(()=>finish(new Error('代码运行超时，已停止。请检查循环或递归。')),Math.min(15000,Math.max(100,Number(timeoutMs)||5000)));
        }else if(data.kind==='result')finish(null,{stdout:data.stdout});
        else if(data.kind==='error')finish(new Error((data.stdout||'')+data.message));
      };
      worker.onerror=(event)=>{event.preventDefault();finish(new Error(event.message||'代码运行环境加载失败'));};
      worker.postMessage({language,code});
    });
  }
  function reset(){completed=false;stopCode();try{resetHandler();}catch(e){error(e);}}
  window.InteractiveRuntime=Object.freeze({ready,error,reset,runCode,stopCode,onReset:fn=>{resetHandler=fn;},complete:()=>{if(!completed){completed=true;send('INTERACTIVE_COMPLETED');}}});
  addEventListener('message',event=>{
    if(event.source!==parent || event.data?.version!==1)return;
    if(event.data.type==='INTERACTIVE_RESET')reset();
    if(event.data.type==='INTERACTIVE_PING' && readySent)send('INTERACTIVE_READY');
  });
  // 正常练习错误由页面 catch 展示，未处理错误才使整页降级。
  addEventListener('error',event=>{if(event.message)error(event.message);});
  addEventListener('unhandledrejection',event=>error(event.reason));
  addEventListener('pagehide',stopCode);
})();
</script>`;
}
