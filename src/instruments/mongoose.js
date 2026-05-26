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
    schema.pre(
        ['find', 'findOne', 'updateOne', 'updateMany', 'save', 'deleteOne', 'deleteMany', 'aggregate', 'countDocuments'],
        function (next) {
            this._startTime = process.hrtime.bigint();
            next();
        }
    );

    schema.post(
        ['find', 'findOne', 'updateOne', 'updateMany', 'save', 'deleteOne', 'deleteMany', 'aggregate', 'countDocuments'],
        function (result, next) {
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

            const operation = this.op || (typeof this.isNew === 'boolean' ? 'save' : 'unknown');

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

            next();
        }
    );

    schema.post(
        ['find', 'findOne', 'updateOne', 'updateMany', 'save', 'deleteOne', 'deleteMany', 'aggregate', 'countDocuments'],
        function (error, doc, next) {
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

            const operation = this.op || (typeof this.isNew === 'boolean' ? 'save' : 'unknown');

            mongooseQueryErrorsTotal.inc({
                collection: collectionName,
                operation: operation,
                error_type: error.name || 'Error',
                ...defaultLabelValues
            });

            next(error);
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
