export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(message: string) {
    super(message);
    this.name = "UniqueConstraintError";
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(message = "Cannot modify a record referenced by another table.") {
    super(message);
    this.name = "ForeignKeyError";
  }
}
