import 'dotenv/config'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { AuthConfig } from './auth/auth.config'
import { HttpExceptionFilter } from './common/http-exception.filter'

async function bootstrap(): Promise<void> {
  AuthConfig.getJwtSecret()
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: AuthConfig.getTrustedOrigins(),
    credentials: true,
  })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(process.env.PORT ?? 3000)
}

void bootstrap()
