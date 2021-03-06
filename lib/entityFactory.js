'use strict';

const _ = require( 'lodash' );
const Promise = require( 'bluebird' );
const Diaspora = require( './diaspora' );
const DataStoreEntity = require( './dataStoreEntities/baseEntity' );

const entityPrototype = {
	model: {
		writable:   false,
		enumerable: true, 
	},
	dataSources: {
		writable:   false,
		enumerable: true, 
	},
	toObject: {
		writable:   false,
		enumerable: true, 
	},
	persist: {
		writable:   false,
		enumerable: true, 
	},
	fetch: {
		writable:   false,
		enumerable: true, 
	},
	destroy: {
		writable:   false,
		enumerable: true, 
	},
	getState: {
		writable:   false,
		enumerable: true, 
	},
	getLastDataSource: {
		writable:   false,
		enumerable: true, 
	},
	getUidQuery: {
		writable:   false,
		enumerable: true, 
	},
	getTable: {
		writable:   false,
		enumerable: true, 
	},
};
const entityPrototypeProperties = _.keys( entityPrototype );

function EntityFactory( name, modelAttrs, model ) {
	const modelAttrsKeys = _.keys( modelAttrs );

	/**
	 * @class Entity
	 * @classdesc An entity is a document in the population of all your datas of the same type
	 * @description Create a new entity
	 * @public
	 * @author gerkin
	 * @param {Object} source Hash with properties to copy on the new object
	 */
	function Entity( source = {}) {
		// Stores the object state
		let state = 'orphan';
		let lastDataSource = null;
		const dataSources = Object.seal( _.mapValues( model.dataSources, () => undefined ));
		
		if ( source instanceof DataStoreEntity ) {
			state = 'sync';
			lastDataSource = source.dataSource.name;
			dataSources[lastDataSource] = source;
			source = source.toObject();
		}
		// Check keys provided in source
		const sourceKeys = _.keys( source );
		// Check if there is an intersection with reserved, and have differences with model attributes
		const sourceUReserved = _.intersection( source, entityPrototypeProperties );
		if ( 0 !== sourceUReserved.length ) {
			throw new Error( `Source has reserved keys: ${ JSON.stringify( sourceUReserved ) } in ${ JSON.stringify( source ) }` );
		}
		const sourceDModel = _.difference( source, modelAttrsKeys );
		if ( 0 !== sourceDModel.length ) { // Later, add a criteria for schemaless models
			throw new Error( `Source has unknown keys: ${ JSON.stringify( sourceDModel ) } in ${ JSON.stringify( source ) }` );
		}
		// Now we know that the source is valid. First, deeply clone to detach object values from entity
		let attributes = _.cloneDeep( source );
		// Free the source
		source = null;
		// Default model attributes with our model desc
		Diaspora.default( attributes, modelAttrs );
		// Define getters & setters
		const entityDefined = Object.defineProperties( this, _.extend({
			model: {
				value: model, 
			},
			dataSources: {
				value: dataSources, 
			},
			toObject: {
				value: function toObject() {
					return _.omit( attributes, entityPrototypeProperties ); 
				}, 
			},
			persist: {
				value: function persist( sourceName ) {
					const dataSource = this.model.getDataSource( sourceName );
					let promise;
					// Depending on state, we are going to perform a different operation
					if ( 'orphan' === state ) {
						promise = dataSource.insertOne( this.getTable( sourceName ), this.toObject());
					} else {
						promise = dataSource.updateOne( this.getTable( sourceName ), this.getUidQuery( dataSource ), this.toObject());
					}
					state = 'syncing';
					lastDataSource = dataSource.name;
					return promise.then( dataStoreEntity => {
						state = 'sync';
						entityDefined.dataSources[dataSource.name] = dataStoreEntity;
						attributes = dataStoreEntity.toObject();
						return Promise.resolve( this );
					});
				}, 
			},
			fetch: {
				value: function fetch( sourceName ) {
					const dataSource = this.model.getDataSource( sourceName );
					let promise;
					// Depending on state, we are going to perform a different operation
					if ( 'orphan' === state ) {
						promise = Promise.reject( 'Can\'t fetch an orphan entity' );
					} else {
						promise = dataSource.findOne( this.getTable( sourceName ), this.getUidQuery( dataSource ));
					}
					state = 'syncing';
					lastDataSource = dataSource.name;
					return promise.then( dataStoreEntity => {
						state = 'sync';
						entityDefined.dataSources[dataSource.name] = dataStoreEntity;
						attributes = dataStoreEntity.toObject();
						return Promise.resolve( this );
					});
				}, 
			},
			destroy: {
				value: function destroy( sourceName ) {
					const dataSource = this.model.getDataSource( sourceName );
					let promise;
					if ( 'orphan' === state ) {
						promise = Promise.reject( 'Can\'t destroy an orphan entity' );
					} else {
						promise = dataSource.deleteOne( this.getTable( sourceName ), this.getUidQuery( dataSource ));
					}
					state = 'syncing';
					lastDataSource = dataSource.name;
					return promise.then( dataStoreEntity => {
						// If this was our only data source, then go back to orphan state
						if ( 0 === _.without( model.dataSources, dataSource.name ).length ) {
							state = 'orphan';
							delete attributes.id;
							delete attributes.idHash;
						} else {
							state = 'sync';
							delete attributes.idHash[dataSource.name];
						}
						entityDefined.dataSources[dataSource.name] = undefined;
						dataStoreEntity = null;
						return Promise.resolve( this );
					});
				}, 
			},
			getState: {
				value: function getState() {
					return state; 
				}, 
			},
			getLastDataSource: {
				value: function getLastDataSource() {
					return lastDataSource; 
				}, 
			},
			getUidQuery: {
				value: function getUidQuery( dataSource ) {
					return {
						id: attributes.idHash[dataSource.name],
					};
				}, 
			},
			getTable: {
				value: function getTable( sourceName ) {
					return name;
				}, 
			},
		}));
		const entityProxied = new Proxy( entityDefined, {
			get: ( obj, key ) => {
				if ( 'constructor' === key ) {
					return entityDefined[key];
				}
				if ( entityDefined.hasOwnProperty( key )) {
					return entityDefined[key];
				}
				return attributes[key];
			},
			set: ( obj, key, value ) => {
				if ( entityDefined.hasOwnProperty( key )) {
					console.warn( `Trying to define read-only key ${ key }.` );
					return value;
				}
				return attributes[key] = value;
			},
			enumerate: obj => {
				return _.keys( attributes );
			},
			ownKeys: obj => {
				return _( attributes ).keys().concat( entityPrototypeProperties ).value();
			},
			has: ( obj, key ) => {
				return attributes.hasOwnProperty( key );
			},
		});
		return entityProxied;
	}
	const EntityWrapped = Object.defineProperties( Entity, {
		/**
		 * @property {String} name Name of the class
		 * @memberof Entity
		 * @static
		 * @public
		 * @author gerkin
		 */
		name: {
			value:      `${ name  }Entity`,
			writable:   false,
			enumerable: true, 
		},
		/**
		 * @property {Model} model Reference to this entity's model
		 * @memberof Entity
		 * @static
		 * @public
		 * @author gerkin
		 */
		model: {
			value:      model,
			writable:   false,
			enumerable: true, 
		},
	});
	return EntityWrapped;
}

// Add prototype infos to the function, so users can know which props are used.
_.assign( EntityFactory, {
	entityPrototype,
	entityPrototypeProperties,
});

module.exports = EntityFactory;
