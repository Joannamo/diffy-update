/**
 * EMC (EFE Model & Collection)
 * Copyright 2016 Baidu Inc. All rights reserved.
 *
 * @file update helper module
 * @author otakustay
 */

import {createDiffNode, isDiffNode as isDiffNodeActual} from './diffNode';

/**
 * 判断一个对象是否为差异节点
 *
 * 如果一个对象为差异节点，那么它有且仅有以下属性：
 *
 * - `changeType`表示修改的类型，值为`"add"`、`"remove"`或者`"change"`
 * - `oldValue`表示修改前的值，如果`changeType`为`"add"`则值恒定为`undefined`
 * - `newValue`表示修改后的值，如果`changeType`为`"remove"`则值恒定为`undefined`
 *
 * @param {*} node 用于判断的节点
 * @return {boolean}
 * @deprecated 请使用`diffNod©e.isDiffNode`代替
 */
export function isDiffNode(node) {
    console.warn('isDiffNode in update module is deprecated, use isDiffNode in diffNode module instead.');

    return isDiffNodeActual(node);
}

let clone = target => {
    if (Array.isArray(target)) {
        return Array.from(target);
    }

    return Object.assign({}, target);
};

let isEmpty = target => {
    for (let key in target) {
        if (target.hasOwnProperty(key)) {
            return false;
        }
    }

    return true;
};

let pick = (target, keys) => keys.reduce(
    (result, key) => {
        result[key] = target[key];
        return result;
    },
    {}
);

const AVAILABLE_COMMANDS = {
    $set(container, propertyName, newValue) {
        let oldValue = container[propertyName];
        if (newValue === oldValue) {
            return [oldValue, null];
        }
        return [
            newValue,
            createDiffNode(container.hasOwnProperty(propertyName) ? 'change' : 'add', oldValue, newValue)
        ];
    },

    $push(container, propertyName, newValue) {
        let array = container[propertyName];

        if (!Array.isArray(array)) {
            console.warn('Usage of $push command on non array object may produce unexpected result.');
        }

        let result = array.concat([newValue]);
        return [
            result,
            createDiffNode('change', array, result)
        ];
    },

    $unshift(container, propertyName, newValue) {
        let array = container[propertyName];

        if (!Array.isArray(array)) {
            console.warn('Usage of $unshift command on non array object may produce unexpected result.');
        }

        let result = [newValue].concat(array);
        return [
            result,
            createDiffNode('change', array, result)
        ];
    },

    $splice(container, propertyName, [start, deleteCount, ...items]) {
        let array = container[propertyName];

        if (!Array.isArray(array)) {
            console.warn('Usage of $splice command on non array object may produce unexpected result.');
        }

        let result = array.slice(0, start).concat(items).concat(array.slice(start + deleteCount));
        return [
            result,
            createDiffNode('change', array, result)
        ];
    },

    $merge(container, propertyName, extensions) {
        let target = container[propertyName];
        if (target == null) {
            let newValue = clone(extensions);
            return [
                newValue,
                createDiffNode(container.hasOwnProperty(propertyName) ? 'change' : 'add', target, newValue)
            ];
        }

        let diff = {};
        let newValue = clone(target);
        for (let key of Object.keys(extensions)) {
            let [propertyValue, propertyDiff] = AVAILABLE_COMMANDS.$set(newValue, key, extensions[key]);
            if (propertyDiff) {
                diff[key] = propertyDiff;
                newValue[key] = propertyValue;
            }
        }
        if (isEmpty(diff)) {
            diff = null;
        }
        return [newValue, diff];
    },

    $defaults(container, propertyName, defaults) {
        let target = container[propertyName];
        let overrideKeys = Object.keys(defaults).filter(key => target[key] === undefined);
        let extensions = pick(defaults, overrideKeys);
        return AVAILABLE_COMMANDS.$merge(container, propertyName, extensions);
    },

    $invoke(container, propertyName, factory) {
        let newValue = factory(container[propertyName]);
        return AVAILABLE_COMMANDS.$set(container, propertyName, newValue);
    }
};

const AVAILABLE_COMMAND_KEYS = Object.keys(AVAILABLE_COMMANDS);
const AVAILABLE_COMMAND_ENTRIES = Object.entries(AVAILABLE_COMMANDS);

/**
 * 根据提供的指令更新一个对象，返回更新后的新对象以及新旧对象的差异（diff），原对象不会作任何的修改
 *
 * 现有支持的指令包括：
 *
 * - `$set`：修改指定的属性值
 * - `$push`：向类型为数组的属性尾部添加元素
 * - `$unshift`：向类型为数组的属性头部添加元素
 * - `$merge`：将2个对象进行浅合并（不递归）
 * - `$defaults`：将指定对象的属性值填到原属性为`undefined`的属性上
 * - `$invoke`：用一个工厂函数的返回值作为`$set`指令的输入，工厂函数接受属性的旧值作为唯一的参数
 *
 * 可以在一次更新操作中对不同的属性用不同的指令：
 *
 * ```javascript
 * import {withDiff} from 'diffy-update';
 *
 * let [newObject, diff] = withDiff(
 *     source,
 *     {
 *         foo: {bar: {$set: 1}},
 *         alice: {$push: 1},
 *         tom: {jack: {$set: {x: 1}}
 *     }
 * );
 * ```
 *
 * 该函数返回一个数组，其中第二个元素为对象更新前后的差异，一个差异对象大致有以下结构：
 *
 * ```javascript
 * {
 *     foo: {
 *         bar: {
 *             changeType: 'add' // can be "add", "change" or "remove",
 *             oldValue: [1, 2, 3],
 *             newValue: [2, 3, 4]
 *         }
 *     }
 * }
 * ```
 *
 * 我们可以对差异对象进行简单的遍历，其中通过`isDiffNode`函数判断的节点即为差异节点，因此我们可以找到对象更新前后的最小差异
 *
 * **需注意的是当前版本并未实现数组类型的差异描述**
 *
 * @param {Object} source 待更新的对象
 * @param {Object} commands 用于更新的指令
 * @return {Array} 函数返回一个数组，结构为`[newObject, diff]`，其中
 *     `newObject`为更新后的对象，`diff`为更新前后的差异,
 *     `diff` is a diff object between the original object and the modified one.
 */
export function withDiff(source, commands) {
    // 如果根节点就是个指令，那么直接对输入的对象进行操作，不需要再遍历属性了
    let possibleRootCommand = AVAILABLE_COMMAND_KEYS.find(key => commands.hasOwnProperty(key));
    if (possibleRootCommand) {
        let wrapper = {source};
        let commandValue = commands[possibleRootCommand];
        let [newValue, diff] = AVAILABLE_COMMANDS[possibleRootCommand](wrapper, 'source', commandValue);
        return [newValue, diff];
    }

    let [result, diff] = Object.entries(commands).reduce(
        ([result, diff], [key, propertyCommand]) => {
            // 找到指令节点后，对当前属性进行更新
            let tryExecuteCommand = ([command, execute]) => {
                if (propertyCommand.hasOwnProperty(command)) {
                    let [newValue, propertyDiff] = execute(result, key, propertyCommand[command]);
                    result[key] = newValue;
                    if (propertyDiff) {
                        diff[key] = propertyDiff;
                    }
                    return true;
                }
                return false;
            };

            let isCommand = AVAILABLE_COMMAND_ENTRIES.some(tryExecuteCommand);
            // 如果这个节点不代表指令，那么肯定它的某个属性（或子属性）是指令，继续递归往下找
            if (!isCommand) {
                let [newValue, propertyDiff] = withDiff(result[key] || {}, propertyCommand);
                result[key] = newValue;
                if (propertyDiff) {
                    diff[key] = propertyDiff;
                }
            }

            return [result, diff];
        },
        [clone(source), {}]
    );

    if (isEmpty(diff)) {
        diff = null;
    }
    return [result, diff];
}

function buildPathObject(path, value) {
    if (path == null) {
        return value;
    }

    if (!Array.isArray(path)) {
        path = [path];
    }

    let result = {};
    let current = result;
    for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]] = {};
    }
    current[path[path.length - 1]] = value;
    return result;
}

/**
 * 效果等同于`withDiff`函数，但不返回差异对象
 *
 * @param {Object} source 待更新的对象
 * @param {Object} commands 用于更新的指令
 * @return {Object} 更新后的新对象
 */
export default function update(source, commands) {
    return withDiff(source, commands)[0];
}

/**
 * 针对`$set`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {*} value 用于更新的值
 * @return {Object} 更新后的新对象
 */
export function set(source, path, value) {
    return update(source, buildPathObject(path, {$set: value}));
}

/**
 * 针对`$push`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {*} value 用于更新的值
 * @return {Object} 更新后的新对象
 */
export function push(source, path, value) {
    return update(source, buildPathObject(path, {$push: value}));
}

/**
 * 针对`$unshift`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {*} value 用于更新的值
 * @return {Object} 更新后的新对象
 */
export function unshift(source, path, value) {
    return update(source, buildPathObject(path, {$unshift: value}));
}

/**
 * 针对`$splice`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {number} start 插入起始位置
 * @param {number} deleteCount 删除的元素个数
 * @param {...*} items 插入的元素
 * @return {Object} 更新后的新对象
 */
export function splice(source, path, start, deleteCount, ...items) {
    return update(source, buildPathObject(path, {$splice: [start, deleteCount, ...items]}));
}

/**
 * 针对`$merge`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {*} value 用于更新的值
 * @return {Object} 更新后的新对象
 */
export function merge(source, path, value) {
    return update(source, buildPathObject(path, {$merge: value}));
}

/**
 * 针对`$defaults`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {*} value 用于更新的值
 * @return {Object} 更新后的新对象
 */
export function defaults(source, path, value) {
    return update(source, buildPathObject(path, {$defaults: value}));
}

/**
 * 针对`$invoke`指令的快捷函数
 *
 * @param {Object} source 待更新的对象
 * @param {string?|Array.<string>|number?|Array.<number>} path 属性的路径，如果更新二层以上的属性则需要提供一个字符串数组，
 *     如果该参数为`undefined`或`null`，则会直接对`source`对象进行更新操作
 * @param {Function} factory 用于生成新值的工厂函数
 * @return {Object} 更新后的新对象
 */
export function invoke(source, path, factory) {
    return update(source, buildPathObject(path, {$invoke: factory}));
}
