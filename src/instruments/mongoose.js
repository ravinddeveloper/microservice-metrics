import {
    mongooseQueryDuration,
    mongooseQueryTotal,
    mongooseQueryErrorsTotal,
    mongooseAggregationDuration,
    mongooseReconnectsTotal,
    defaultLabelValues
} from '../metrics.js';
import mongoose from 'mongoose';
let isConnected = false;



/*
* This plugin should be applied to all schemas before model creation
* Example: 
*   const MySchema = new mongoose.Schema({
*       name: String,
*   });
*   MongooseHook.initializeMongoosePreHooks(MySchema);
*   mongooseMetricsPlugin(MySchema);
*   const MyModel = mongoose.model('MyModel', MySchema);
*/
const mongooseMetricsPlugin = (schema) => {
    const hooks = [
        'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
        'updateOne', 'updateMany', 'save', 'insertMany', 'deleteOne', 'deleteMany',
        'aggregate', 'count', 'countDocuments', 'estimatedDocumentCount'
    ];

    schema.pre(
        hooks,
        function (next) {
            this._startTime = process.hrtime.bigint();
            next();
        }
    );

    schema.post(
        hooks,
        function (result, next) {
            try {
                if (!this._startTime) {
                    return next();
                }

                const durationSeconds = Number(process.hrtime.bigint() - this._startTime) / 1e9;
                let collectionName = 'unknown';

                if (this.mongooseCollection && this.mongooseCollection.name) {
                    collectionName = this.mongooseCollection.name;
                } else if (this.model && this.model.collection && this.model.collection.name) {
                    collectionName = this.model.collection.name;
                } else if (this._model && this._model.collection && this._model.collection.name) {
                    collectionName = this._model.collection.name;
                } else if (this.constructor && this.constructor.collection && this.constructor.collection.name) {
                    collectionName = this.constructor.collection.name;
                } else if (this.collection && this.collection.name) {
                    collectionName = this.collection.name;
                }

                let operation = this.op;
                if (!operation) {
                    if (typeof this.pipeline === 'function') {
                        operation = 'aggregate';
                    } else if (typeof this.isNew === 'boolean') {
                        operation = 'save'; // Document middleware
                    } else if (this.prototype && this.prototype.$isMongooseDocument) {
                        operation = 'insertMany'; // Model middleware
                    } else {
                        operation = 'unknown';
                    }
                }

                mongooseQueryTotal.inc({
                    collection: collectionName,
                    operation: operation,
                    ...defaultLabelValues
                });

                mongooseQueryDuration.observe(
                    {
                        collection: collectionName,
                        operation: operation,
                        ...defaultLabelValues
                    },
                    durationSeconds
                );

                if (operation === 'aggregate') {
                    mongooseAggregationDuration.observe(
                        {
                            collection: collectionName,
                            ...defaultLabelValues
                        },
                        durationSeconds
                    );
                }
            } catch (err) {
                console.error("Error in mongoose metrics post hook:", err);
            } finally {
                next();
            }
        }
    );

    schema.post(
        hooks,
        function (error, doc, next) {
            try {
                let collectionName = 'unknown';

                if (this.mongooseCollection && this.mongooseCollection.name) {
                    collectionName = this.mongooseCollection.name;
                } else if (this.model && this.model.collection && this.model.collection.name) {
                    collectionName = this.model.collection.name;
                } else if (this._model && this._model.collection && this._model.collection.name) {
                    collectionName = this._model.collection.name;
                } else if (this.constructor && this.constructor.collection && this.constructor.collection.name) {
                    collectionName = this.constructor.collection.name;
                } else if (this.collection && this.collection.name) {
                    collectionName = this.collection.name;
                }

                let operation = this.op;
                if (!operation) {
                    if (typeof this.pipeline === 'function') {
                        operation = 'aggregate';
                    } else if (typeof this.isNew === 'boolean') {
                        operation = 'save';
                    } else if (this.prototype && this.prototype.$isMongooseDocument) {
                        operation = 'insertMany';
                    } else {
                        operation = 'unknown';
                    }
                }

                mongooseQueryErrorsTotal.inc({
                    collection: collectionName,
                    operation: operation,
                    error_type: error.name || 'Error',
                    ...defaultLabelValues
                });
            } catch (err) {
                console.error("Error in mongoose metrics post error hook:", err);
            } finally {
                next(error);
            }
        }
    );
};

/**
 * this should be imported after all schema initializations and before model creation or use mongooseDefaultMetricsPlugin()
*/
const mongooseDefaultMetricsPlugin = () => {
    if (typeof mongoose.plugin === 'function') {
        mongoose.plugin(mongooseMetricsPlugin);
    }
    else if (typeof mongoose.modelNames === 'function') {
        mongoose.modelNames().forEach(modelName => {
            const schema = mongoose.model(modelName).schema;
            if (schema) {
                schema.plugin(mongooseMetricsPlugin);
            }
        });
    }

    if (mongoose.connection && !isConnected) {
        isConnected = true;
        mongoose.connection.on('reconnected', () => {
            mongooseReconnectsTotal.inc(defaultLabelValues);
        });
    }
};


export { mongooseMetricsPlugin, mongooseDefaultMetricsPlugin };
