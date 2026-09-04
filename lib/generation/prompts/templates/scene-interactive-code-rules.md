## 生成 code：真正可编辑、可执行、可验证的编程实验，不是源码卡片或预设输出。

语言遵循 widgetOutline.language，支持 python/javascript，未指定默认 python。提供简洁题意、含 TODO 的 starterCode、运行输出、测试用例通过/失败、渐进提示、重置。左侧代码区是主要工作区：代码、提示和参考答案必须在左侧同一面板内切换，提示与答案不得放进右侧输出与测试栏。点击提示或参考答案时切换左侧视图，保留一个明确入口返回代码；切换视图不能压缩代码编辑区到难以阅读。可通过 HTTPS CDN 加载固定版本 CodeMirror；若编辑器加载失败保留 textarea，不能整页无法输入。

编辑器外层使用 min-height:0;overflow:hidden，CodeMirror 高度绑定到外层实际高度，覆盖 CDN 默认的 300px 高度；工具栏 flex-shrink:0，编辑器不能溢出遮挡运行按钮。不要用不确定父高度下的 height:100% 撑开 flex 布局。

学生代码统一通过平台提供的可终止 Worker 运行，不在 UI 线程 eval/new Function，不自行加载 Pyodide或另造执行器：

await InteractiveRuntime.runCode({language:'python',code:source,timeoutMs:5000}) 返回 {stdout:string}；失败会 reject Error。Python 首次调用自动加载 Pyodide，加载与执行有独立超时。JavaScript 支持 console.log 和异步函数，但不支持 DOM/Node.js；不需要服务端执行或真实模型 API。

运行按钮读取编辑器此刻内容。测试把学生源码与真正调用目标函数的断言拼成一次执行，成功才显示通过/调用 complete；不能仅按字符串包含答案判对。测试用例输入、预期、实际应清楚，补全多例和必要边界。普通运行与提交测试分开，不因一次 print 就完成。

参考模式：try{const {stdout}=await InteractiveRuntime.runCode({language,code:source+'\n'+testCode});output.textContent=stdout; /* 仅断言全部通过才 complete */}catch(error){output.textContent=error.message}finally{runButton.disabled=false}

提供停止按钮调用 InteractiveRuntime.stopCode()。运行期间禁用重复执行，catch中将语法/断言/超时作为页内反馈。reset 恢复 starterCode、输出、提示与测试状态；旧异步回调用轮次标记忽略，避免重置后显示过期结果。
