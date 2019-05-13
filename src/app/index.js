// @ts-check
import sync from 'framesync'
import { createStore, registerPlugins } from '../utils'
import eventBus from '../modules/eventBus'

function debounce(func, wait, immediate) {
	let timeout
	return function(...args) {
		const context = this
		const later = function() {
			timeout = null
			if (!immediate) func.apply(context, args)
		}
		const callNow = immediate && !timeout
		clearTimeout(timeout)
		timeout = setTimeout(later, wait)
		if (callNow) func.apply(context, args)
	}
}

/**
 * create a cache object
 * this is used to store any active modules
 *
 * @public
 * @type {Object}
 */
export const cache = createStore()

/**
 * return a registerPlugin function, this is used to
 * add plugins to the cache
 *
 * @public
 * @type {Object}
 */
export const registerPlugin = registerPlugins(cache)

/**
 * @function loadModule
 * @description function used to load modules and add to the cache
 * @namespace
 * @param {object} config deconstructed object
 * @param {function} config.module the module to load
 * @param {HTMLElement} config.node the html element to bind the module to
 * @param {boolean} config.keepAlive should the module be destroyed between page transitions
 * @param {string} config.key a unique key, used as a cache reference
 * @return {void}
 */
function loadModule({ module, node, keepAlive, key }) {
	// if the cache already contains some plugins
	// remove them all, they have been destroyed
	if (cache.get(key) && cache.get(key).plugins) {
		cache.set(key, {
			plugins: []
		})
	}

	/**
	 * bind the regsiter plugin function to the current key
	 *
	 * @private
	 * @type {Object}
	 */
	const register = registerPlugin(key)

	/**
	 * call the function, returning the result to destroyModule
	 * this function will be called when the module is destroyed
	 *
	 * @private
	 * @type {Object}
	 */
	const destroyModule = module({
		node,
		name: key
	})

	// set the cache props
	cache.set(key, {
		hasLoaded: true,
		keepAlive,
		module: destroyModule
	})

	// if the function should not be kept alive, register the module for destruction
	if (!keepAlive) {
		register(destroyModule)
	}
}

/**
 * @typedef {function} Use
 * @property {string} key the plugin name
 * @property {function} func the plugin function
 * @property {object} options the plugins options
 * @return {function}
 */

/**
 * @description returns a factory function used to add plugins to the app
 * A function is returned that when called will with the following props
 * app.use('routes', (options) => {console.console.log(options.a)}, {a: 10})
 * will add a routes item to the plugins cache
 * @function use
 * @param {object} plugins an array to store the plugins in
 * @return {Use}
 */
function use(plugins) {
	/**
	 * @function addPlugin
	 * @param {string} key
	 * @param {function} func
	 * @param {object} options
	 * @return {void}
	 */
	function addPlugin(key, func, options = {}) {
		const plug = func({
			eventBus,
			...options
		})

		plugins[key] = plug
	}

	return addPlugin
}

/**
 * @typedef {Object} App
 * @property {function} hydrate finds modules and calls them
 * @property {function} destroy destroys any valid modules
 * @property {function} on the mitt on method
 * @property {function} off the mitt off method
 * @property {function} emit the mitt emit method
 * @property {function} loadModules
 * @property {Use} use the use function
 * @property {object} plugins the plugins object
 */

/**
 * @function loadApp
 * @namespace loadApp
 * @param {HTMLElement} context the root html element to query from
 * @return {App}
 */
export default function loadApp(context, { fetch: fetchModule }) {
	let handle

	/**
	 * The plugins store
	 *
	 * @private
	 * @type {Object}
	 */
	const plugins = {}

	/**
	 * @memberof loadApp
	 * @function scan
	 * @description function used to fetch required modules, watch for window size changes
	 * and destory modules that fail media query returns
	 * @return {void}
	 */
	function scan() {
		/**
		 * The current list to scan
		 *
		 * @private
		 * @type {Object}
		 */
		const list = cache.store

		Object.entries(list).forEach(([key, item]) => {
			const { query, name, node, hasLoaded, module, keepAlive } = item

			// if the module has loaded
			if (hasLoaded) {
				// if the query has failed
				if (query && !window.matchMedia(query).matches) {
					const { plugins } = cache.get(key)
					if (plugins && plugins.length) {
						plugins.forEach(fn => {
							fn()
						})
					} else {
						if (typeof module === 'function') {
							module()
						}
					}

					// update the cache
					cache.set(key, {
						hasLoaded: false
					})
				}
				return
			}
			// if there is a query and it matches, or if there is no query at all
			if (window.matchMedia(query).matches || typeof query === 'undefined') {
				if (cache.get(key) && cache.get(key).hasLoaded) return
				// fetch the behaviour
				fetchModule(name)
					.then(resp => {
						const { default: module } = resp
						loadModule({ module, node, keepAlive, key })
					})
					.catch(err => {
						console.log(`error loading ${name}`, err)
					})
			}
		})
	}

	/**
	 * @function getNodes
	 * @memberof loadApp
	 * @inner
	 * @param {HTMLElement} node
	 * @return {Array}
	 */
	function getNodes(node) {
		return [...node.querySelectorAll('*[data-behaviour]')]
	}

	/**
	 * @method hydrate
	 * @memberof loadApp
	 * @inner
	 * @description queries the given context for elements with data-behaviour attributes
	 * any matches are added to the cache.
	 * the scan function is then called, as well as a window resize event is added
	 * which also calls the scan function
	 * @param {HTMLElement} context the node to query from
	 * @return {void}
	 */
	function hydrate(context) {
		sync.read(() => {
			getNodes(context)
				.filter(({ id, dataset: { keepAlive, behaviour } }, index) => {
					const key = id || `${behaviour}-${index}`
					return keepAlive === 'true' || !cache.has(key)
				})
				.forEach((node, index) => {
					const { id } = node
					const { behaviour, query, keepAlive, ...rest } = node.dataset
					if (behaviour.split(' ').length > 1) {
						throw new TypeError(
							'you are only allowed to use on behaviour per dom node'
						)
					}

					if (!id) {
						// eslint-disable-next-line
						console.warn(
							`${behaviour} is missing an id, behaviour name has been used instead`
						)
					}

					const key = id || `${behaviour}-${index}`

					const item = {
						key,
						name: behaviour,
						node,
						data: rest,
						hasLoaded: false
					}
					if (typeof keepAlive !== 'undefined') item.keepAlive = true
					if (query) item.query = query
					cache.set(key, item)
				})

			scan()
			handle = debounce(scan, 100)
			window.addEventListener('resize', handle)
		})
	}

	/**
	 * @method destroy
	 * @memberof loadApp
	 * @inner
	 * @description loops through the cache, destroying any modules on the killList
	 * @returns {void}
	 */
	function destroy() {
		window.removeEventListener('resize', handle)
		const killList = Object.values(cache.store).filter(
			({ keepAlive }) => !keepAlive
		)

		// destroy each module and any plugins attached
		killList
			.reduce((acc, { plugins }) => {
				if (plugins) {
					acc.push(...plugins)
				}
				return acc
			}, [])
			.filter(destroy => typeof destroy === 'function')
			.forEach(destroy => destroy())

		// remove the item from the store
		killList.forEach(({ key }) => cache.delete(key))
	}

	// hydate the world
	hydrate(context)

	return {
		hydrate,
		destroy,
		...eventBus,
		use: use(plugins),
		loadModules: fns => {
			fns.forEach(fn => {
				loadModule(fn)
			})
		},
		get plugins() {
			return plugins
		}
	}
}
