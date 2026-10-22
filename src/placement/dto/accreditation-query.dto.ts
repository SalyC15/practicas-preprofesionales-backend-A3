import { Matches } from 'class-validator'
import { PageQueryDto } from '../../common/page-query.dto'

export class AccreditationQueryDto {
  @Matches(/^\d{4}-[12]$/, { message: 'period debe tener el formato AAAA-1 o AAAA-2' })
  period!: string
}

export class AccreditationPageQueryDto extends PageQueryDto {
  @Matches(/^\d{4}-[12]$/)
  period!: string
}
