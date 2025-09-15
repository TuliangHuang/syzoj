import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class Question extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  parent_id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  source: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  description: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  answer: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  tutorial: string;

  async changeID(id) {
    const entityManager = TypeORM.getManager();

    id = parseInt(id);

    // Update primary key and all referencing tables
    await entityManager.query('UPDATE `question`         SET `id`          = ' + id + ' WHERE `id`          = ' + this.id);
    await entityManager.query('UPDATE `question_tag_map` SET `question_id` = ' + id + ' WHERE `question_id` = ' + this.id);

    const oldID = this.id;
    this.id = id;

    await this.save();

    await Question.deleteFromCache(oldID);
  }
}
