import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class Question extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Index({ unique: true })
  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  uid: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  source: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  description: string;
}
