@Library('jenkins-shared-library') _

pipeline {
  agent any

  environment {
    CI = true

    AWS_ACCOUNT_ID            = "211418496259"
    AWS_REGION                = "us-east-1"
    AWS_DEFAULT_REGION        = "${AWS_REGION}"

    ECR_REGISTRY              = "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    ECR_REGISTRY_URL          = "https://${ECR_REGISTRY}"
    ECR_REGISTRY_CREDENTIALS  = "ecr:us-east-1:ecr-ci"

    INFRA_CLI_IMAGE_VERSION   = "0.0.14"
    INFRA_CLI_IMAGE           = "${ECR_REGISTRY}/mubi/images/infra-cli:${INFRA_CLI_IMAGE_VERSION}"
  }

  stages {
    stage('Clean up') {
      agent {
        docker {
          image                 env.INFRA_CLI_IMAGE
          registryUrl           env.ECR_REGISTRY_URL
          registryCredentialsId env.ECR_REGISTRY_CREDENTIALS
          args                  '--user 1000 --entrypoint='
        }
      }
      steps {
        script {
          cleanUp("image")
        }
      }
    }
  }

  post {
    always {
      cleanWs()
    }
  }
}
