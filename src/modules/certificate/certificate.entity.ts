import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A TLS certificate (+ private key) uploaded by the operator, usable by any
 * number of application domains (a wildcard serves many). The private key is
 * stored encrypted and never returned by any endpoint; the only plaintext
 * copy lives in the proxy's cert volume (mode 0600).
 */
@Entity({ name: 'custom_certificates' })
export class CustomCertificate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  /** Normalized PEM bundle: the server certificate first, then the chain. Public. */
  @Column({ name: 'certificate_pem', type: 'text' })
  certificatePem: string;

  @Column({ name: 'private_key_encrypted', type: 'text', select: false })
  privateKeyEncrypted: string;

  @Column({ name: 'common_name', type: 'varchar', nullable: true })
  commonName: string | null;

  /** DNS names the certificate covers (SANs; the CN only when there are no DNS SANs). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  domains: string[];

  @Column({ type: 'varchar' })
  issuer: string;

  @Column({ name: 'not_before', type: 'timestamptz' })
  notBefore: Date;

  @Column({ name: 'not_after', type: 'timestamptz' })
  notAfter: Date;

  /** SHA-256 of the server certificate, openssl style (`AB:CD:…`). */
  @Column()
  fingerprint: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
