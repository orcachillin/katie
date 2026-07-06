import { Migration } from "@mikro-orm/migrations";

export class InitialMigration extends Migration {
    async up(): Promise<void> {
        this.addSql("CREATE EXTENSION IF NOT EXISTS vector");
    }
}