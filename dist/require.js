"use strict";
;
(function (window, Map) {
    let STATUS;
    (function (STATUS) {
        STATUS[STATUS["WAITING"] = 0] = "WAITING";
        STATUS[STATUS["FETCHING"] = 1] = "FETCHING";
        STATUS[STATUS["READY"] = 2] = "READY";
        STATUS[STATUS["SUCCESS"] = 3] = "SUCCESS";
        STATUS[STATUS["ERROR"] = 4] = "ERROR";
    })(STATUS || (STATUS = {}));
    const moduleMap = new Map();
    const taskMap = new Map();
    /**
     * 依赖模块类
     *
     * _id        模块的唯一标识符
     * STATUS     模块当前的加载状态
     * _callback  模块依赖加载成功之后的回调函数
     * _error     模块依赖加载失败的回调函数
     * _deps      模块依赖的数组，标识符为_id
     * _depsCount 当前模块所依赖的模块数
     *
     * @class Module
     */
    class Module {
        /**
         * Creates an instance of Module.
         * @param {ModuleMap} moduleMap 模块Map实例
         * @param {Context} context require的全局上下文
         * @param {(string | number)} [task] 依赖当前模块的任务或者模块
         * @memberof Module
         */
        constructor(moduleMap, context, task) {
            this._STATUS = STATUS.WAITING;
            this._task = [];
            this._id = moduleMap.size + 1;
            this._context = context;
            if (task) {
                this._task.push(task);
            }
            this._STATUS = STATUS.WAITING;
        }
        /**
         * 初始化模块
         *
         * @param {string} name 模块名
         * @param {string[]} dependents 模块依赖数组
         * @param {Callback} callback 模块依赖加载成功的回调函数
         * @param {ErrorCallback} [error] 模块依赖加载失败的回调函数
         * @memberof Module
         */
        init(name, dependents, callback, error) {
            this.name = name;
            this._callback = callback;
            this._error = error;
            this._depsCount = dependents.length;
            this._deps = dependents;
        }
        /**
         * 当前模块的依赖个数统计，当该值变为0的时候，执行该模块的成功回调
         *
         * @memberof Module
         */
        set depsCounts(depsCount) {
            if (depsCount === 0) {
                this.callHook(STATUS.READY);
            }
            else {
                this._depsCount = depsCount;
            }
        }
        get depsCounts() {
            return this._depsCount;
        }
        /**
         * 当前模块所处的状态，
         * SUCCESS表示模块调用成功，然后对于依赖该模块的task或者module进行状态修改
         * ERROR表示模块依赖出错，直接执行依赖该模块的task或者module的错误处理
         * READY表示模块依赖加载成功，可以调用本模块的成功回调
         *
         * @memberof Module
         */
        set STATUS(status) {
            this._STATUS = status;
            if (status === STATUS.ERROR) {
                for (let value of this._task) {
                    typeof value === 'string' && this._context.moduleMap.get(value).applyCallback(status, this._errorEvent);
                    typeof value === 'number' && this._context.taskMap.get(value).applyCallback(status, this._errorEvent);
                }
            }
            else if (status === STATUS.SUCCESS) {
                for (let value of this._task) {
                    typeof value === 'string' && this._context.moduleMap.get(value).applyCallback(status);
                    typeof value === 'number' && this._context.taskMap.get(value).applyCallback(status, this._export);
                }
            }
            if (status === STATUS.READY) {
                try {
                    let deps = [];
                    for (let value of this._deps) {
                        deps.push(this._context.moduleMap.get(value).getExport());
                    }
                    this._export = this._callback.apply(this, deps);
                    if (!this._export) {
                        throw new ReferenceError('module must have a return value');
                    }
                }
                catch (error) {
                    this._errorEvent = error;
                    this._error && this._error.call(this, error);
                    this.callHook(STATUS.ERROR);
                }
                finally {
                    if (this._export) {
                        this.callHook(STATUS.SUCCESS);
                    }
                }
            }
        }
        get STATUS() {
            return this._STATUS;
        }
        /**
         * 执行当前模块，如果当前模块的依赖已经完成，那么直接加载当前模块
         * 如果依赖未完成，则对每个依赖进行解析，实例化每个依赖的module实例，并且加载该模块
         *
         * @memberof Module
         */
        exec() {
            const deps = this._deps;
            if (!deps.length) {
                this.callHook(STATUS.READY);
            }
            for (let name of deps) {
                if ((moduleMap.has(name)) &&
                    (moduleMap.get(name).STATUS === STATUS.SUCCESS)) {
                    this.depsCounts = this.depsCounts - 1;
                }
                else {
                    const module = new Module(this._context.moduleMap, this._context, this.name);
                    module.fetchModule(name);
                }
            }
        }
        /**
         * 异步加载当前模块
         *
         * @param {string} name
         * @memberof Module
         */
        fetchModule(name) {
            this.callHook(STATUS.FETCHING);
            const path = this._context.basePath + name + '.js';
            const script = document.createElement('script');
            const body = this._context.bodyDOM;
            const that = this;
            script.setAttribute('type', 'text/javascript');
            script.setAttribute('src', path);
            script.onerror = function (ev) {
                that.callHook(STATUS.ERROR);
            };
            body.appendChild(script);
            this._context.moduleMap.set(name, this);
        }
        /**
         * 提供给外部的回调，当外部模块加载成功或者失败，调用该函数
         *
         * @param {STATUS} status
         * @param {*} [payload]
         * @memberof Module
         */
        applyCallback(status, payload) {
            if (status === STATUS.SUCCESS) {
                this.depsCounts = this.depsCounts - 1;
            }
            else {
                this._error && this._error.call(this, payload);
                payload && (this._errorEvent = payload);
                this.callHook(STATUS.ERROR);
            }
        }
        callHook(status) {
            this.STATUS = status;
        }
        getModuleId() {
            return this._id;
        }
        getExport() {
            return this._export;
        }
    }
    /**
     * require任务类
     * _id            每一个task的唯一标识符
     * _callback      task的成功回调函数
     * _error         task的失败回调函数
     * _deps          task的依赖数组，以Module._id进行标识
     * _depsCount     task的未加载依赖个数
     *
     * @class Task
     */
    class Task {
        constructor(moduleMap, dependents, context, taskMap, callback, error) {
            this._id = taskMap.size + 1;
            this._callback = callback;
            this._error = error;
            this._depsCount = dependents.length;
            this._context = context;
            this._deps = dependents;
        }
        /**
         * 任务依赖计算，当任务依赖为0时，则可以执行其回调
         *
         * @memberof Task
         */
        set depsCounts(depsCount) {
            if (depsCount === 0) {
                this._depsCount = 0;
                let deps = [];
                for (let value of this._deps) {
                    deps.push(this._context.moduleMap.get(value).getExport());
                }
                this._callback.apply(this, deps);
            }
            else {
                this._depsCount = depsCount;
            }
        }
        get depsCounts() {
            return this._depsCount;
        }
        getTaskId() {
            return this._id;
        }
        /**
         * 执行该任务，检查依赖情况，并且进行对于仍未实例化的依赖进行实例化并且加载
         *
         * @param {ModuleMap} moduleMap
         * @memberof Task
         */
        exec(moduleMap) {
            const deps = this._deps;
            for (let name of deps) {
                if ((moduleMap.has(name)) &&
                    (moduleMap.get(name).STATUS === STATUS.SUCCESS)) {
                    this.depsCounts = this.depsCounts - 1;
                }
                else {
                    const module = new Module(this._context.moduleMap, this._context, this._id);
                    module.fetchModule(name);
                }
            }
        }
        applyCallback(status, payload) {
            if (status === STATUS.SUCCESS) {
                this.depsCounts = this.depsCounts - 1;
            }
            else {
                this._error && this._error.call(this, payload);
                throw new Error(payload);
            }
        }
    }
    /**
     * require的全局上下文
     *
     * @class Context
     */
    class Context {
        constructor(dataMain, moduleMap, taskMap) {
            this._fetchError = function (ev) {
                window.console.error(ev.error);
                return ev;
            };
            this.URLReg = /((?:\w*\/)*)((?:\w+).js)/;
            const matchResult = dataMain.match(this.URLReg);
            this.bodyDOM = document.querySelector('body');
            this.taskMap = taskMap;
            this.moduleMap = moduleMap;
            let entryFile;
            if (matchResult) {
                this.basePath = matchResult[1];
                this.entryFile = matchResult[2];
            }
            else {
                throw new URIError('The data-main file\'s URL is an illegal URL.');
            }
            this.$init();
        }
        $init() {
            const script = document.createElement('script');
            script.setAttribute('type', 'text/javascript');
            script.setAttribute('src', this.basePath + this.entryFile);
            script.onerror = this._fetchError;
            this.bodyDOM.appendChild(script);
        }
    }
    // 实例化全局上下文，require方法，define方法
    const context = (function init(moduleMap, taskMap) {
        const scripts = document.querySelectorAll('script');
        let dataMain = '';
        Array.prototype.forEach.call(scripts, function (value) {
            value.getAttribute('data-main') && (dataMain = value.getAttribute('data-main'));
        });
        return new Context(dataMain, moduleMap, taskMap);
    })(moduleMap, taskMap);
    const require = function (deps, callback, error) {
        const task = new Task(moduleMap, deps, context, taskMap, callback, error);
        taskMap.set(task.getTaskId(), task);
        task.exec(moduleMap);
    };
    const define = function (name, deps, callback, error) {
        let module;
        if (moduleMap.get(name)) {
            module = moduleMap.get(name);
        }
        else {
            module = new Module(moduleMap, context);
            moduleMap.set(name, module);
        }
        module.init(name, deps, callback, error);
        module.exec();
    };
    // 将方法绑定到window对象上，实现外部调用
    if (!window.hasOwnProperty('require') && !window.hasOwnProperty('define')) {
        Object.defineProperties(window, {
            require: {
                value: require,
                configurable: false,
                writable: false,
                enumerable: false
            },
            define: {
                value: define,
                configurable: false,
                writable: false,
                enumerable: false
            }
        });
    }
})(window, Map);
//# sourceMappingURL=require.js.map