class ContractError extends Error {
    constructor (message) {
        super(message);
        this.name = this.constructor.name;
        this.message = message;
        Error.captureStackTrace(this, this.constructor);
    }
}

class OutOfRangeError extends Error {
    constructor (message) {
        super(message);
        this.name = this.constructor.name;
        this.message = message;
        Error.captureStackTrace(this, this.constructor);
    }
}

class DatabaseError extends Error {
    constructor (error) {
        super(error);
        this.name = this.constructor.name;
        this.stack = error.stack;
        this.code = error.code;
        this.sqlMessage = error.sqlMessage;
        this.sql = error.sql;
        //Error.captureStackTrace(this, this.constructor);
    }
}
module.exports = {ContractError, DatabaseError, OutOfRangeError};